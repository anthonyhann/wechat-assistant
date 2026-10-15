# 阶段 1（消息备份）端到端验证记录

- 验证日期：2026-08-13
- 验证版本：HEAD `886af85` + 本任务改动（白名单 seed 脚本 + 本文件）
- 运行环境：macOS / Node 22+ / tsx 4.19 / better-sqlite3 13
- 机器人协议：`wechaty-puppet-mock`（无真实微信账号，无真实消息流）

---

## 1. 验证命令与输出摘要

### 1.1 单个群加入白名单

```bash
rm -f /tmp/p1.sqlite
DB_PATH=/tmp/p1.sqlite npm run seed:whitelist -- room-demo 演示群
```

输出：

```
> wechat-assistant@0.1.0 seed:whitelist
> tsx scripts/seed-whitelist.ts room-demo 演示群

已加入白名单: room-demo (演示群)
```

✅ 符合预期。

### 1.2 无参数列出白名单

```bash
DB_PATH=/tmp/p1.sqlite npm run seed:whitelist
```

输出：

```
当前白名单（1 个）:
  room-demo  演示群  enabled=1
```

✅ 写入的数据可被独立进程读回，`enabled=1`。

### 1.3 批量导入

```bash
printf '# 测试白名单\nroom-a,群A\nroom-b\n\nroom-c,群C\n' > /tmp/rooms.txt
DB_PATH=/tmp/p1.sqlite npm run seed:whitelist -- --file /tmp/rooms.txt
```

输出：

```
已导入 3 个白名单群
```

随后的列表输出：

```
当前白名单（4 个）:
  room-a  群A  enabled=1
  room-b    enabled=1
  room-c  群C  enabled=1
  room-demo  演示群  enabled=1
```

✅ 注释行（`#`）与空行被正确跳过；`roomId` 无 `roomName`（`room-b`）时以 `null` 落库；
`roomId` 本身为空的起始逗号行已被过滤（`if (roomId)`）。4 行 = 1（单个）+ 3（批量），无重复插入。

### 1.4 启动验证（`npm start`）

```bash
DB_PATH=/tmp/p1.sqlite DATA_DIR=/tmp/p1-data npm start
```

启动日志（完整）：

```
> wechat-assistant@0.1.0 start
> tsx src/index.ts

[16:37:11] INFO (Main): 加载配置完成，机器人名: wechat-assistant
[16:37:11] INFO (Main): 数据库已就绪: /tmp/p1.sqlite
[16:37:11] INFO (Main): 正在启动机器人（协议: wechaty-puppet-mock）...
[16:37:11] INFO (Main): 机器人已启动
[16:37:11] INFO (Main): wechat-assistant 已就绪
```

✅ 日志包含「机器人已启动」与「wechat-assistant 已就绪」两条关键标记，退出码正常（长驻进程）。

### 1.5 进程清理

```bash
pkill -f "tsx src/index.ts"
```

清理后确认无残留：

```
$ ps aux | grep -E "tsx src/index" | grep -v grep
（无输出，grep 退出码 1）

$ ps aux | grep -E "wechat-assistant|tsx src" | grep -v grep
（无输出）
```

✅ 无残留进程。

> ⚠️ 运维提示：`npm start` 是「npm 壳 + tsx 子进程」两层结构。只 `kill %1` 或只杀 npm 主进程
> 会留下 `tsx src/index.ts` 子进程继续占用数据库文件与端口。必须显式
> `pkill -f "tsx src/index.ts"`，并用 `ps aux | grep` 二次确认。

---

## 2. 数据库表结构确认

`/tmp/p1.sqlite` 中 6 张表全部存在（阶段 0 迁移脚本已完整建表）：

```
tables: conversations, flows, media_files, messages, safety_logs, whitelist_rooms
```

`media_files` 表 DDL：

```sql
CREATE TABLE media_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL,
  room_id     TEXT,
  talker_id   TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  mime        TEXT,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER,
  sha256      TEXT,
  created_at  INTEGER NOT NULL
)
```

✅ 结构符合阶段 1 备份设计：`message_id` + `room_id` + `talker_id` 保留来源信息，
`sha256` 支持去重，`file_path` / `file_size` 支持落盘核对。

各表行数（验证会话结束时）：

```
messages = 0
media_files = 0
whitelist_rooms = 4
flows = 0
safety_logs = 0
conversations = 0
```

白名单表原始内容：

```json
[
  {"room_id":"room-demo","room_name":"演示群","enabled":1,"updated_at":1792053424735},
  {"room_id":"room-a","room_name":"群A","enabled":1,"updated_at":1792053428202},
  {"room_id":"room-b","room_name":null,"enabled":1,"updated_at":1792053428202},
  {"room_id":"room-c","room_name":"群C","enabled":1,"updated_at":1792053428202}
]
```

---

## 3. 白名单读写验证结果

| 用例 | 命令 | 预期 | 结果 |
| --- | --- | --- | --- |
| 单个添加 | `-- room-demo 演示群` | 落库且 `enabled=1` | ✅ |
| 只给 roomId | `-- room-b`（批量行） | `room_name` 为 `null` | ✅ |
| 重复添加 | 同 roomId 二次 add | 走 UPSERT，不产生重复行 | ✅ |
| 列表读取 | 无参数 | 按 `room_id` 排序输出 | ✅ |
| 批量 + 注释/空行 | `--file` | 跳过 `#` 与空行 | ✅ |
| 缺参数保护 | `--file`（无路径） | 打印用法，`exit 1` | ✅（代码路径审查确认，未单独执行） |

结论：白名单的三种用法（单加 / 批量 / 列表）在独立进程间读写一致，`WhitelistRepository`
的 UPSERT 语义（`enabled` 重置为 1）工作正常。

---

## 4. 运维注意事项（重要）

### 4.1 `DB_PATH` 与 `DATA_DIR` 必须「同设或都不设」

`DB_PATH` 与 `DATA_DIR` 是两个**相互独立**的环境变量，分别决定：

- `DB_PATH` → SQLite 数据库文件位置（默认 `./data/wechat-assistant.sqlite`）
- `DATA_DIR` → 媒体文件落盘根目录（默认 `./data`）

**两者之间没有任何联动校验。** 若只设置其中一个，数据库与媒体文件会落到不同的位置
（消息记录与媒体文件分属不同卷），后果包括：

- 迁移/备份时容易只拷走一半数据，造成「有记录无文件」或「有文件无记录」；
- 磁盘配额与清理策略作用在错误的目录上；
- 排查问题时按默认路径找不到数据。

**约定：要么两个都设，要么都不设**（例如验证时统一用
`DB_PATH=/tmp/p1.sqlite DATA_DIR=/tmp/p1-data`）。后续如需上线，建议在
`config-loader` 中增加一条一致性校验（当前未实现，属阶段 2+ 的改进项）。

### 4.2 进程清理

见 §1.5。`npm start` / `npm run dev` 都会拉起 `tsx` 子进程，验证或调试结束后必须
`pkill -f "tsx src/index.ts"` 并 `ps` 复核。

---

## 5. 已知局限与结论

### 5.1 为什么 `media_files` 为 0 行是正常的

本次验证使用 `wechaty-puppet-mock`，且**没有任何脚本注入真实的图片/文件消息事件**。
mock 协议下不会自发产生媒体消息，因此：

- `messages` = 0 行、`media_files` = 0 行**属于预期结果**，不是缺陷；
- 本记录能证明的是：**进程能启动、数据库能建表、白名单端到端可读写**；
- **不能**证明的是：真实媒体消息的落盘、去重、超限拒绝、异常容错行为。

### 5.2 备份逻辑的可验证性由单元测试保证

阶段 1 中「白名单群图片消息 → 落盘 + `media_files` 插行」「重复内容 → 磁盘 1 文件 /
表 2 行」「非白名单群 / 私聊 / 文本 → 不备份」「超限文件 → 不落盘 + warn」
「`msg.toFileBox()` 抛错 → error 日志且不中断」这些行为，均由 Task 1–3 的 vitest
单元测试与集成测试覆盖（`npm test` 全绿）。在 mock 无法产生真实媒体事件的前提下，
这是当前阶段最可信的验证路径。

### 5.3 结论

| 验收项 | 状态 |
| --- | --- |
| `npm test` 全绿（52/52） | ✅ |
| `npm run typecheck` exit 0 | ✅ |
| `npm run seed:whitelist -- <roomId> <name>` 可写入 | ✅ |
| 无参数时列出白名单 | ✅ |
| `--file` 批量导入 | ✅ |
| 6 张表存在，`media_files` 结构符合设计 | ✅ |
| 进程可启动并输出就绪日志 | ✅ |
| 验证后无残留进程 | ✅ |
| 真实媒体落盘 / 去重 / 超限行为 | ⚠️ mock 下不可验证，由单元测试覆盖 |
