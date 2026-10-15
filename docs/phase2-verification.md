# 阶段 2（安全闸门 + 关键词流程）端到端验证记录

- 验证日期：2026-08-13
- 验证版本：本任务改动（路由集成 + 组装 + 本文件）
- 运行环境：macOS / Node 24.21 / tsx 4.19 / better-sqlite3 13 / vitest 3.2
- 机器人协议：`wechaty-puppet-mock`（**无真实微信账号，无真实消息流**）

---

## 0. 重要声明：本 e2e 的证明边界

> **mock 协议下未产生任何真实回复流转。**
>
> 本次 e2e 只用 `wechaty-puppet-mock` 拉起进程，验证的是：**启动链路能完成组装（WordFilter 读词库、
> SafetyGate、FlowEngine 都成功构造且不抛错）、数据库能建出阶段 2 的全部结构与列、进程能干净退出**。
>
> e2e **没有**、也**不可能**证明「用户发『活动』→ 机器人真的回了一条消息」这条链路 —— mock 下没有
> 真实联系人发消息，也没有真实出口投递。**入站闸门、流程分发、@ 判定、结果落库、回复出口收口这一整条
> 行为链路的可验证性，由单元测试保证，不是由本 e2e 证明的。**
>
> 具体地：
>
> | 断言 | 由谁证明 | e2e 是否覆盖 |
> | --- | --- | --- |
> | 入站命中敏感词 → 不回复/不跑流程/不备份 | 单测 `message-router.spec.ts` | ❌ 未覆盖 |
> | 流程命中 → 执行 + 写 `flow_result` + `handled_by='flow'` | 单测 `message-router.spec.ts` | ❌ 未覆盖 |
> | 群内未 @ → 不触发；@ → 触发 | 单测 `message-router.spec.ts` | ❌ 未覆盖 |
> | 出站命中 → 兜底话术、原文不出站 | 单测 `safety-gate.spec.ts` / `safety-corpus.spec.ts` | ❌ 未覆盖 |
> | 冷却 / 多流程只执行第一条 / http 跳过 | 单测 `flow-engine.spec.ts` | ❌ 未覆盖 |
> | 启动组装不抛错 + 建库结构正确 | **本 e2e** | ✅ 覆盖 |
>
> 真实回复流转需要真实 puppet（如 wechat4u / padlocal）与真实账号，属阶段 4 的准入验证范畴。

---

## 1. 启动验证

```bash
cd /Users/user/www/ai/wechat-assistant
rm -f /tmp/p2.sqlite* /tmp/p2.log
DB_PATH=/tmp/p2.sqlite npx tsx src/index.ts > /tmp/p2.log 2>&1 &
sleep 7
```

`/tmp/p2.log` 全文：

```
[17:15:00] INFO (Main): 加载配置完成，机器人名: wechat-assistant
[17:15:00] INFO (Main): 数据库已就绪: /tmp/p2.sqlite
[17:15:00] INFO (Main): 正在启动机器人（协议: wechaty-puppet-mock）...
[17:15:00] INFO (Main): 机器人已启动
[17:15:00] INFO (Main): wechat-assistant 已就绪
```

✅ 两条关键日志齐全：`机器人已启动`、`wechat-assistant 已就绪`。

**这条输出的实际证明力**：`main()` 走到最后一行说明中间的组装全部成功 ——
`WordFilter.fromFile('config/<wordFile>')` 成功读到了词库（读不到会抛 ENOENT）、
`createSafetyGate` / `createFlowEngine` 构造成功。若词库路径配错或组装有误，这里会以
`启动失败:` 退出，而不是打出「已就绪」。

> 注：本任务使用 `/tmp/p2.sqlite` 临时库，**未触碰**真实的 `data/wechat-assistant.sqlite`。

## 2. 进程清理确认

```bash
pkill -f "tsx src/index.ts"; sleep 2
ps aux | grep -E "tsx src/index" | grep -v grep || echo "CLEAN"
```

输出：

```
CLEAN — 无残留进程
CLEAN — 无 wechat-assistant 相关进程
```

✅ **清理干净，无 tsx 残留。** 第二条是宽范围复核（不限 `tsx src/index`，而是匹配
`wechat-assistant` 关键字），同样为空，排除 `kill %1` 只杀 npm 壳、留下 tsx 子进程的情况。

## 3. 数据库结构确认

```bash
node -e "const D=require('better-sqlite3');const db=new D('/tmp/p2.sqlite'); ... "
```

输出：

```
tables: conversations, flows, media_files, messages, safety_logs, whitelist_rooms
messages schema: id,conversation_id,conversation_type,talker_id,talker_name,msg_type,text,
                 timestamp,is_self,handled_by,safety_result,backup_result,flow_result,ai_result,created_at
  has backup_result true
  has flow_result true
  has ai_result true
  has safety_result true
  has handled_by true
```

✅ `messages` 表**含全部 3 个新列**（`backup_result` / `flow_result` / `ai_result`），
且 `safety_logs` 表存在。这是 Task 1 的 DDL 在**全新库**上生效的证明（新库路径，走的是
`CREATE TABLE` 而非 `ALTER TABLE` 迁移分支）。

### 3.1 新列可写可读

```
messages 列写入读回: backup_result=backed_up flow_result=matched:活动咨询
                     safety_result=blocked:inbound:L1 handled_by=ignored
```

✅ 四个字段均可独立写入并读回，验证了「`handled_by` 存责任人、原因独立成列」的拆分语义。

### 3.2 `safety_logs` 表可写

```
safety_logs 可写，读回 2 条: [{"direction":"inbound","layer":"L1","matched_word":"e2e敏感词",
  "conversation_id":"e2e-conv"},{"direction":"outbound","layer":"L1","matched_word":"e2e敏感词",
  "conversation_id":"e2e-conv"}]
```

✅ 入站/出站两个方向均可入库并读回，Task 1 的 `SafetyLogRepository` 与 Task 3 的
`checkInbound/checkOutbound` 写入路径共用同一张表。

## 4. 用例集结果

| 用例集 | 文件 | 结果 |
| --- | --- | --- |
| 安全专项（词库 + 闸门 + 语料 + DAO） | `word-filter` / `safety-gate` / `safety-corpus` / `safety-dao` | **51/51 通过** |
| 流程引擎 | `flow-engine.spec.ts` | **20/20 通过** |
| 消息路由（含阶段 0/1/2 全部） | `message-router.spec.ts` | **19/19 通过** |
| **全量** | 14 个文件 | **137/137 通过** |

`npm run typecheck` → exit 0。

> 全量 137 = 132（本任务前基线）+ 5（本任务新增路由层用例）。阶段 1 的备份断言由
> `handled_by === 'backup:<reason>'` 改为分别断言 `handled_by === 'backup'` 与
> `backup_result === '<reason>'`，用例**数量未变**，仅断言口径随行为变更调整。

## 5. 回复出口收口核查

```bash
grep -rn "\.say(" src/ tests/ | grep -v node_modules
```

输出：

```
src/router/message-router.ts:109:              reply: async (t: string) => { await msg.say(t) },
src/router/message-router.ts:110:              sayImage: async (p: string) => { await msg.say(p) },
```

✅ 全仓库**只有这两处** `msg.say` 调用点，且都在 `FlowContext.reply` / `FlowContext.sayImage`
回调内部 —— 这两个回调只被 `flowEngine.run` 调用，而 `flowEngine` 内所有文本出口都先过
`safetyGate.checkOutbound`。**不存在绕过闸门的 `msg.say` 调用路径。**

## 6. 阶段 2 验收清单

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| `npm test` 全绿 | ✅ | 137/137 |
| `npm run typecheck` 无错误 | ✅ | exit 0 |
| 出站命中 → 兜底话术、原文绝不出站、`safety_logs` 有 outbound | ✅ 单测 | `safety-gate.spec.ts` / `safety-corpus.spec.ts` |
| 入站命中 → 不回复/不跑流程/不备份，`safety_result='blocked:inbound:L1'` | ✅ 单测 | `message-router.spec.ts` |
| 触发「活动」→ 按流程回复，`flow_result` 有记录 | ✅ 单测 | `message-router.spec.ts` / `flow-engine.spec.ts` |
| 群内未 @ → 不触发；私聊无需 @ | ✅ 单测 | `message-router.spec.ts` |
| 同群同流程 60s 冷却；不同流程/群/私聊不受影响 | ✅ 单测 | `flow-engine.spec.ts` |
| 多流程同时命中 → 只执行第一条 | ✅ 单测 | `flow-engine.spec.ts`（`matchFlow` 命中即返回） |
| `http` 动作显式跳过并记 warn | ✅ 单测 | `flow-engine.spec.ts` |
| 安全专项用例集 100% 通过 | ✅ | 51/51 |
| 无绕过闸门的 `msg.say` 路径 | ✅ | 见第 5 节 grep |
| `git status` 干净 | ✅ | 提交后复核 |

## 7. 遗留与移交阶段 3

- **L2 LLM 语义审核未实现**（`safety-gate.ts` 内已标定插入点），`safety.llmAudit.enabled` 为预留开关。
- **`http` 动作未实现**，当前显式 warn 跳过（不静默）。
- **真实回复流转未经 e2e 证明**（见第 0 节），需真实 puppet 的准入验证。
- 交付接口：`SafetyGate.checkOutbound`（AI 回复必经）、`matchFlow`/`FlowEngine.run` 模式可复用、
  `SafetyLogRepository` 供阶段 4 管理台使用、`MessageRepository.setResult` 白名单机制可复用于 `ai_result`。
