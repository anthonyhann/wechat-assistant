# 上线前准备：真实 LLM 联调 + 敏感词库补齐

- 日期：2026-10-16
- 状态：**已完成**，真实 LLM 联调 15/15 通过，词库补齐至 609 词

## 1. 敏感词库补齐

### 结果

`config/sensitive-words.txt` 从占位状态（[political] 1 词、[self] 5 词、其余三节为空）
补齐为**通用基线**：**609 词 + 3 条正则规则**，五分类全部非空。

| 分类 | 词数 | 覆盖 |
|------|------|------|
| `political` | 61 | 涉政敏感、煽动、邪教、维权、审查规避 |
| `adult` | 80 | 色情服务、性行为、低俗擦边、成人用品 |
| `violence` | 153 | 暴力/恐怖、武器制作、毒品、自杀、非法拘禁 |
| `self` | 135 | **prompt injection 特征**（忽略指令/角色劫持/越狱/索要提示词/索要密钥/绕过安全） |
| `illegal` | 180 | 博彩、走私、洗钱、传销、诈骗、偷拍、黑产 |

### 过程中发现并修复的真实缺陷

**① `sk-` 短词误伤（设计文档 §4.1 的正则半边从未实现）**

`sk-` 作为子串词放进词库后，实测误伤所有含该子串的正常文本：

```
task-1 ❌ / task-12 ❌ / disk-space ❌ / ask-me ❌ / desk-lamp ❌ / risk-it ❌
```

子串匹配对短特征词无能为力。修复：**从词库移除 `sk-`，在 `WordFilter` 增加正则规则集**
（这正是设计文档 §4.1 承诺但一直未实现的「正则 + 子串匹配」的另一半）：

```typescript
const REGEX_RULES = [
  { category: 'self', name: 'API Key(sk-...)', re: /sk-[A-Za-z0-9]{20,}/ },
  { category: 'self', name: 'API Key(ark-...)', re: /ark-[A-Za-z0-9]{24,}/ },
  { category: 'self', name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
]
```

效果：真 key（`sk-` + 20 位以上）命中，`task-1` / `disk-space` 放行。

**② 口语变体漏过**

「教我做炸弹」未命中（词库只有 `制作炸弹` / `炸弹制作`）。子串匹配要求精确包含完整词条。
已补 `做炸弹` / `造炸弹` / `制造炸弹` / `怎么做炸弹` / `炸药配方` 等口语变体。

### 实测结果

| 指标 | 结果 |
|------|------|
| 误拦（34 条正常业务/技术文本） | **0** |
| 漏过（22 条敏感文本，五分类 + 注入 + 正则） | **0** |

测试扩充：`tests/safety-corpus.spec.ts` 从 6 个攻击用例扩到 **22 个**，并新增
「正则规则精准」与「正常业务话术不误拦」两组回归。

## 2. 真实 LLM 联调

### 提供方选择

用户的 key 是**火山方舟 Coding Plan**（个人版 Lite）。联调过程中确认：

- 标准方舟裸 Bearer 调 `/api/v3/chat/completions` → `InvalidEndpointOrModel.NotFound`（该 key 无权访问标准模型）
- Coding Plan 必须走 arkcli 数据面

因此新增 `arkcli` provider（`src/llm/arkcli-adapter.ts`），把 `LlmAdapter` 桥接到 `arkcli +chat`。

### 联调结果（`scripts/llm-integration-test.ts`）

```
=== 真实 LLM 联调 ===
provider: arkcli（走本机 arkcli 登录态）

【1】基本连通性          ✅ LLM 调用成功
【2】用量追踪            ✅ usage_logs 落库（prompt/completion/total 拆分）
【3】安全闸门            ✅ 注入提问被拦，回复兜底话术，safety_logs 有审计
【4】多轮记忆            ✅ 第二轮准确引用上文（回答「42」）
【5】节流                ✅ 同对话第二次调用被 throttled

=== 联调结果: 15 通过 / 0 失败 ===
```

复现方式：

```bash
cp .env.example .env
# .env 设 LLM_PROVIDER=arkcli 与 ARK_MODEL=<模型名>
# 并确保本机已 arkcli auth login
npm run tsx scripts/llm-integration-test.ts
```

### 联调中修复的真实缺陷

**① `.env.example` 的假契约（env 覆盖从未实现）**

`LLM_PROVIDER` / `ARK_MODEL` / `ARK_BASE_URL` / `OPENAI_MODEL` / `OPENAI_BASE_URL`
只存在于 `.env.example`，`config-loader` 从未消费。用户按示例改了配置，实际仍用
`config/ai.json` 的旧值——表现为「设了 ark 却仍走 mock」与「改了模型却 404」。
已修复：env 覆盖 json（`arkcli` provider 例外，不覆盖 baseUrl）。

**② arkcli 适配器丢弃对话历史**

初版适配器只取 system + 最后一条 user，assistant 历史全丢——模型回答「我没有你之前
让我记住的数字记录」。arkcli `+chat` 是单轮 CLI，已改为**把历史序列化进 prompt**：

```
以下是本次对话的先前记录：
用户：记住这个数字：42。只回答「已记住」
助理：已记住

我刚才让你记住的数字是什么？
```

修复后模型准确回答「42」。

**③ arkcli 的 env 冲突**

适配器把 `.env` 的 `ARK_API_KEY` / `ARK_BASE_URL` 透传给子进程，arkcli 据此进入
「自定义端点 + API Key」模式，与登录态互斥（`plan_agreement_identity_required` /
`custom data-plane base URL requires an explicit --api-key`）。已修复：调用 arkcli 时
剔除这两个变量，路由完全由本机 profile 决定。

**④ 退出崩溃（`process.exit` × pino 异步流）**

联调脚本 `process.exit()` 触发 pino 的 `on-exit` 自动 flush，抛
`sonic boom is not ready yet` 并以非零码退出。修复：文件日志流转 `sync: true` +
新增 `flushLogs()` 双保险。**生产 bot 的 SIGINT/SIGTERM shutdown 路径同步受益**
（此前每次 Ctrl+C 都可能触发该崩溃）。

## 3. 遗留事项

- 词库是**通用基线**：行业黑话需按业务补充（建议运营期持续维护）
- `[adult]` 等分类含部分医疗/两性健康词汇，若业务场景涉及健康咨询需评估误拦面
- 真实对话的费用观察：本次联调 5 次调用消耗 329 tokens（Coding Plan 额度内）
- mock 与 ark/openai provider 的路径已有单测覆盖，但未做真实联调（无对应 key）
