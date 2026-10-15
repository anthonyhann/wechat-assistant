# 阶段 3 端到端验证记录

日期：2026-08-13（会话内系统时间）
验证环境：本机开发机，**无 .env、无真实 LLM API key**。因此 LLM 一律走 mock / 降级路径——这是预期行为，本文件不声称验证了真实 LLM 对话链路。

## 1. 验证一：mock provider 下整机启动

```bash
cd /Users/hanqiang/www/ai/wechat-assistant
rm -f /tmp/p3.sqlite*
DB_PATH=/tmp/p3.sqlite npx tsx src/index.ts > /tmp/p3.log 2>&1 &
sleep 7
grep -E "机器人已启动|已就绪" /tmp/p3.log
pkill -f "tsx src/index.ts"; sleep 1
ps aux | grep -E "tsx src/index" | grep -v grep || echo "CLEAN"
```

输出（日志已去 ANSI 转义）：

```
INFO (Main): 加载配置完成，机器人名: wechat-assistant
INFO (Main): 数据库已就绪: /tmp/p3.sqlite
INFO (Main): 正在启动机器人（协议: wechaty-puppet-mock）...
INFO (Main): 机器人已启动
INFO (Main): wechat-assistant 已就绪
INFO (Main): 收到 SIGTERM，正在退出...
INFO (Main): 正在停止机器人...
INFO (Main): 机器人已停止
```

进程清理：`ps` 复查输出 `CLEAN`，无残留 tsx 进程。

结论：`provider=mock`（config/ai.json 默认）下 index.ts 全链路组装成功——config → db → backup → safetyGate → flowEngine → llm(mock) → memory(镜像) → aiModule → router → bot，启动并就绪，SIGTERM 优雅退出。

## 2. 验证二：provider=ark 但 ARK_API_KEY 缺失 → 降级告警不崩溃

```bash
cp config/ai.json /tmp/ai.json.bak
node -e "const f='config/ai.json';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.provider='ark';require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
DB_PATH=/tmp/p3b.sqlite npx tsx src/index.ts > /tmp/p3b.log 2>&1 &
sleep 6
grep -iE "降级|ARK_API_KEY|未设置" /tmp/p3b.log | head -3
pkill -f "tsx src/index.ts"; sleep 1
cp /tmp/ai.json.bak config/ai.json && rm -f /tmp/ai.json.bak
git diff --stat config/ai.json   # 输出为空（已还原）
```

实测输出：

```
ERROR (Main): provider=ark 但环境变量 ARK_API_KEY 未设置，已降级（AI 功能不可用，将回复兜底话术）
INFO (Main): 数据库已就绪: /tmp/p3b.sqlite
INFO (Main): wechat-assistant 已就绪
```

进程清理：pkill 后 `ps` 复查 `CLEAN`；`config/ai.json` 已还原（`git diff --stat` 为空）。

结论：符合用户决策「key 缺失只告警不崩溃」——`log.error` 留痕、降级为 mock-degraded 适配器（调用时返回失败，走「兜底话术 + 转人工提示」路径），进程正常启动就绪。

## 3. conversations 表结构（记忆镜像落库目标）

```sql
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
```

镜像由 `createMirroredMemory` 完成：写内存窗口的同时落表，**镜像失败只记 error、绝不影响对话主流程**（单测覆盖）。

## 4. 单测/类型检查

- `npm test`：20 个测试文件、215 个用例全部通过（阶段 2 收口时 149 → 阶段 3 Task 1-5 累计 205 → 本任务 +9 → 终审回归用例 +1 = 215）。
- `npm run typecheck`：exit 0。

## 5. 明确声明：未验证的链路

**本次验证在 mock / 无 key 环境下进行，未验证真实 LLM 对话链路**（ark / openai-compat 的真实 HTTP 调用、超时、限流、费用）。该链路的正确性由 Task 1-5 的单测（mock fetch 注入）保证；真实联调需用户提供 `ARK_API_KEY` 或 `OPENAI_API_KEY` 后单独进行，并应观察超时、限流与 token 费用。

## 6. 遗留事项（转阶段 4 及以后）

- 真实 LLM 联调（见上）。
- L2 语义审核未接入（用户决策阶段 3 不接；接入时 `safetyGate.checkOutbound` 需改 async）。
- AI 调用量统计（次数 / 失败 / token）目前只有日志，无聚合表，阶段 4 管理台需要。
- 记忆重启后为空：`conversations` 表有数据但启动时不回灌内存窗口，如需「重启后继续对话」需加预热。
