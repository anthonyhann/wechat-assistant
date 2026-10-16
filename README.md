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
| `config/ai.json` | LLM 配置（provider、model、温度、记忆、节流） |
| `config/safety.json` | 安全配置（词库、兜底话术、审计） |
| `config/flows.json` | 关键词流程（可在管理台在线改） |
| `config/sensitive-words.txt` | 敏感词库（609 词五分类 + 注入特征） |
| `.env` | LLM_PROVIDER / ARK_MODEL / ARK_BASE_URL / API key / WECHATY_PUPPET |

`.env` 的 `LLM_PROVIDER` / `ARK_MODEL` / `ARK_BASE_URL` / `OPENAI_MODEL` / `OPENAI_BASE_URL`
会**覆盖** `config/ai.json` 的同名字段（env 优先，切换提供方是部署期行为）。

## LLM 提供方（四种）

| provider | 凭证 | 说明 |
|----------|------|------|
| `mock` | 无 | 开发模式，回显用户输入，零费用 |
| `arkcli` | 本机 `arkcli auth login` 登录态 | **火山方舟 Coding Plan**（推荐，本机已联调验证 15/15） |
| `ark` | `.env` 的 `ARK_API_KEY` | 标准方舟推理接入点（裸 Bearer 调 `/api/v3`） |
| `openai` | `.env` 的 `OPENAI_API_KEY` | 任意 OpenAI 兼容端点 |

```bash
# 使用 Coding Plan（.env）
LLM_PROVIDER=arkcli
ARK_MODEL=deepseek-v4.1-flash

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
