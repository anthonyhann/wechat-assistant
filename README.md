# 微信社群个人助理

基于 Wechaty 的微信群个人助理：消息备份 / 关键词自动问答 / AI 对话 / 安全闸门 / Web 管理台。

## 快速开始

```bash
npm install
cp .env.example .env  # 按需填写
npm start
```

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
