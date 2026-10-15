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
| `config/sensitive-words.txt` | 敏感词库（分类分节） |
| `.env` | 密钥（ARK_API_KEY / OPENAI_API_KEY / WECHATY_PUPPET） |

## 管理台

启动后访问 `http://127.0.0.1:3000/`（本地回环，生产建议 SSH 隧道访问）。

可选 Bearer 鉴权：`config/bot.json` 的 `adminServer.token` 非空时启用。

## Docker

```bash
docker build -t wechat-assistant .
docker run -v $(pwd)/data:/app/data -v $(pwd)/config:/app/config -v $(pwd)/.env:/app/.env wechat-assistant
```

## 运维

- 数据保留：默认 30 天，启动时自动清理
- 日志：`data/logs/app.log`
- 数据库：`data/wechat-assistant.sqlite`
- 媒体文件：`data/media/`
