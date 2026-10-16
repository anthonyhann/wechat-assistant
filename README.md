# 微信社群个人助理

基于 Wechaty 的微信群个人助理：**消息备份 / 关键词自动问答 / AI 对话 / 内容安全闸门 / Web 管理台**。

## 它能做什么

| 能力 | 触发方式 | 说明 |
|------|---------|------|
| 💾 消息备份 | 自动（白名单群） | 白名单群里的图片/文件自动下载到 `data/media/{群}/{日期}/`，sha256 去重，超 100MB 不下载 |
| 🤖 AI 对话 | 私聊随时；群内需 **@机器人** | 转发到 LLM，带 10 轮/30 分钟记忆窗口，回复经安全闸门 |
| 💬 关键词问答 | 私聊/群内命中触发词 | 按 `config/flows.json` 配置的流程逐步回复（活动/转人工等） |
| 🛡️ 安全闸门 | 自动（所有对外回复） | 609 词本地词库拦截敏感内容 + prompt 注入防护，命中即换兜底话术 |
| 📊 Web 管理台 | 浏览器打开 | 统计看板、消息流水、白名单/流程在线配置、LLM 用量 |
| 🔒 数据保留 | 自动（启动时） | 消息/日志超 30 天自动清理（可配） |

## 快速开始（5 分钟跑起来）

```bash
# 1. 安装依赖
npm install

# 2. 准备配置（.env 控制 LLM 和协议，已按 mock 模式填好）
cp .env.example .env

# 3. 启动
npm start
```

启动成功会看到：

```
加载配置完成，机器人名: wechat-assistant
数据库已就绪: data/wechat-assistant.sqlite
管理台已启动 http://127.0.0.1:3000
机器人已启动
wechat-assistant 已就绪
```

然后**浏览器打开 http://127.0.0.1:3000/** 就能看到管理台看板（统计/消息/白名单/流程/安全日志/LLM 用量）。

> **当前是 mock 模式**（`WECHATY_PUPPET=wechaty-puppet-mock`）——不连真实微信，
> 用于验证机器人的所有逻辑（AI/备份/安全/管理台）都能正常工作。见下方「连上真实微信」。

## 日常使用

### 启动 / 停止
```bash
npm start          # 生产启动
npm run dev        # 开发模式（改代码自动重启）
# 停止：Ctrl+C（会优雅退出：停管理台→停机器人→关数据库）
```

### 管理台操作（http://127.0.0.1:3000/）
- **看板**：今日消息数、备份文件数/体积、AI 调用数、安全拦截数、今日 token 消耗
- **白名单**：在线增删要备份的群（`PUT /api/whitelist`，改完立即生效，不用重启）
- **流程**：查看关键词流程（在线编辑见下方）
- **安全日志**：哪些消息被拦了、命中了什么词

也可以用命令行（不用开浏览器）：
```bash
# 加白名单
curl -X PUT http://127.0.0.1:3000/api/whitelist \
  -H 'content-type: application/json' \
  -d '{"roomId":"xxx@chatroom","roomName":"我的群"}'

# 看统计
curl http://127.0.0.1:3000/api/stats

# 看 LLM 用量
curl "http://127.0.0.1:3000/api/usage?days=7"
```

### 配置白名单（另一种方式：命令行）
```bash
npm run seed:whitelist -- "xxx@chatroom" "群名"
npm run seed:whitelist                    # 列出当前白名单
```

### 改 AI 回复的「人格」
编辑 `config/ai.json` 的 `systemPrompt`，重启生效。

### 改关键词回复流程
编辑 `config/flows.json`，或在管理台在线改（`PUT /api/flows`，热生效）。

### 验证 LLM 真的通了
```bash
npm run tsx scripts/llm-integration-test.ts
```
会真实调用 LLM，检查 5 项：连通性、用量记录、安全拦截、多轮记忆、节流。

## 连上真实微信

mock 模式只验证逻辑。要收发真实微信消息，改 `.env` 的协议（**三选一**）：

| 协议 | 特点 | 适用 |
|------|------|------|
| `wechaty-puppet-mock`（默认） | 不连微信，纯逻辑验证 | 开发/测试 |
| `wechaty-puppet-wechat4u` | 免费 Web 协议 | 个人试用，**有封号风险** |
| `wechaty-puppet-service` | 官方付费协议 | 稳定生产（需买 token） |

```bash
# 切到免费协议（.env）
WECHATY_PUPPET=wechaty-puppet-wechat4u
```
然后 `npm start`，终端会弹出**登录二维码**，用微信扫码即可。上线前建议评估换付费协议。

## 配置

| 文件 | 说明 |
|------|------|
| `config/bot.json` | 机器人名、触发策略、管理台端口 |
| `config/backup.json` | 备份规则（白名单、类型、大小上限、保留天数） |
| `config/ai.json` | LLM 配置（provider、温度、记忆、节流、providerOverrides） |
| `config/safety.json` | 安全配置（词库、兜底话术、审计） |
| `config/flows.json` | 关键词流程（可在管理台在线改） |
| `config/sensitive-words.txt` | 敏感词库（609 词五分类 + 注入特征） |
| `.env` | LLM_PROVIDER / LLM_MODEL / 各厂商 API key / WECHATY_PUPPET |

`.env` 的 `LLM_PROVIDER` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY_ENV`
会**覆盖** `config/ai.json`（env 优先，切换提供方是部署期行为）。

## LLM 提供方（12 家 + mock）

`provider` 字段填下面的名字即可，**baseUrl / apiKeyEnv / model 都有 preset 默认值**：

| 分类 | provider | 协议 | key 环境变量 |
|------|----------|------|-------------|
| 国内 | `deepseek` | OpenAI 兼容 | `DEEPSEEK_API_KEY` |
| 国内 | `qwen`（通义） | OpenAI 兼容 | `DASHSCOPE_API_KEY` |
| 国内 | `glm`（智谱） | OpenAI 兼容 | `ZHIPU_API_KEY` |
| 国内 | `kimi`（月之暗面） | OpenAI 兼容 | `MOONSHOT_API_KEY` |
| 国内 | `doubao`（豆包，别名 `ark`） | OpenAI 兼容 | `ARK_API_KEY` |
| 国内 | `minimax` | OpenAI 兼容 | `MINIMAX_API_KEY` |
| 国内 | `baichuan`（百川） | OpenAI 兼容 | `BAICHUAN_API_KEY` |
| 国外 | `openai` | OpenAI 兼容 | `OPENAI_API_KEY` |
| 国外 | `claude` | **Anthropic Messages** | `ANTHROPIC_API_KEY` |
| 国外 | `gemini` | **Google generateContent** | `GEMINI_API_KEY` |
| 特殊 | `arkcli` | 本机 arkcli CLI | 无需 key（`arkcli auth login`） |
| 开发 | `mock` | 回显 | 无 |

> **新增一家厂商只需在 `config/ai.json` 加一条**（OpenAI 兼容类零代码）：
> ```json
> "providerOverrides": {
>   "deepseek": { "model": "deepseek-reasoner", "baseUrl": "https://my-proxy.example/v1", "apiKeyEnv": "MY_KEY" }
> }
> ```
> 全新协议才需要在 `src/llm/` 加适配器 + 在 `providers.ts` 注册表加 preset。

```bash
# 使用 Coding Plan（.env，推荐——本机已联调 15/15）
LLM_PROVIDER=arkcli
LLM_MODEL=deepseek-v4.1-flash

# 使用 DeepSeek 官方 API
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx

# 联调验证（真实调用，五项全检）
npm run tsx scripts/llm-integration-test.ts
```

> **Coding Plan 注意**：`arkcli` provider 走本机 arkcli 登录态，**不需要**也不应设置
> `ARK_API_KEY` / `ARK_BASE_URL`——这两个变量会让 arkcli 进入「自定义端点 + API Key」
> 模式，与登录态互斥（适配器已自动剔除）。

## 管理台

启动后访问 `http://127.0.0.1:3000/`（本地回环，生产建议 SSH 隧道访问）。

可选 Bearer 鉴权：`config/bot.json` 的 `adminServer.token` 非空时启用。

## Docker

```bash
docker build -t wechat-assistant .
docker run -v $(pwd)/data:/app/data -v $(pwd)/config:/app/config -v $(pwd)/.env:/app/.env wechat-assistant
```

> **注意**：管理台只绑容器内的 `127.0.0.1`，`-p 3000:3000` 端口映射**无法**从宿主机访问
> （回环绑定 × 容器网络命名空间）。容器内访问用 `docker exec -it <container> wget -qO- http://127.0.0.1:3000/api/stats`，
> 或改为宿主机直连部署 / SSH 隧道。

## 运维

- 数据保留：默认 30 天，启动时自动清理
- 日志：`data/logs/app.log`
- 数据库：`data/wechat-assistant.sqlite`
- 媒体文件：`data/media/`
