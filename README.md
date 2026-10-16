<div align="center">

# 🤖 WeChat Community Assistant

**A WeChat bot framework with message backup · keyword auto-reply · AI chat · content safety · web admin dashboard**

Built on [Wechaty](https://github.com/wechaty/wechaty) · TypeScript · SQLite

[English](#-quick-start) · [简体中文](./README.zh-CN.md) · [Documentation](./docs/)

</div>

---

## ✨ Features

| Feature | Trigger | What it does |
|---------|---------|--------------|
| 💾 **Message Backup** | Auto (whitelisted rooms) | Downloads images & files from whitelisted rooms to `data/media/{room}/{date}/`, sha256 dedup, skips files > 100MB |
| 🤖 **AI Chat** | DMs anytime · rooms require **@bot** | Multi-turn conversations via any mainstream LLM, 10-turn / 30-min memory window, all replies pass the safety gate |
| 💬 **Keyword Auto-Reply** | Trigger word match | Config-driven flow engine (`config/flows.json`) — multi-step replies, handoff, more |
| 🛡️ **Content Safety Gate** | Auto (every outbound reply) | 609-word local blocklist + prompt-injection defense; blocked replies get a safe fallback |
| 📊 **Web Admin Dashboard** | Browser | Stats board, message stream, online whitelist/flow config, LLM usage |
| 🔒 **Data Retention** | Auto (on startup) | Messages / logs older than 30 days are auto-purged (configurable) |

## 🏗️ Architecture

```
WeChat  →  Bot (Wechaty)  →  Message Router  ──┬──▶  Backup Module      (whitelist + download + dedup)
                                                ├──▶  Flow Engine        (keyword match + step execution)
                                                ├──▶  Safety Gate        (L1 blocklist + L3 fallback)
                                                └──▶  AI Module          (memory + LLM adapters)
                                                          │
                                                          ▼
                                              LLM Adapters: mock · arkcli · OpenAI-compatible · Claude · Gemini
```

Three-layer defense: **L1** local blocklist (always on, zero cost) · **L2** LLM semantic audit (optional, off by default) · **L3** fallback reply (always on).

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env        # pre-configured for mock mode

# 3. Start
npm start
```

You should see:

```
加载配置完成，机器人名: wechat-assistant
管理台已启动 http://127.0.0.1:3000
机器人已启动
wechat-assistant 已就绪
```

Then open **http://127.0.0.1:3000/** for the admin dashboard.

> **Mock mode is the default** — no real WeChat account needed. Perfect for verifying all logic (AI / backup / safety / dashboard). See [Connecting Real WeChat](./docs/connect-real-wechat.md).

## 🤖 LLM Providers (12 + mock)

Set `LLM_PROVIDER` in `.env` — every provider ships with sane defaults:

| Provider | Protocol | Key Env Var |
|----------|----------|-------------|
| `deepseek` | OpenAI-compatible | `DEEPSEEK_API_KEY` |
| `qwen` (Alibaba) | OpenAI-compatible | `DASHSCOPE_API_KEY` |
| `glm` (Zhipu) | OpenAI-compatible | `ZHIPU_API_KEY` |
| `kimi` (Moonshot) | OpenAI-compatible | `MOONSHOT_API_KEY` |
| `doubao` (Volcano, alias `ark`) | OpenAI-compatible | `ARK_API_KEY` |
| `minimax` | OpenAI-compatible | `MINIMAX_API_KEY` |
| `baichuan` | OpenAI-compatible | `BAICHUAN_API_KEY` |
| `openai` | OpenAI-compatible | `OPENAI_API_KEY` |
| `claude` | Anthropic Messages | `ANTHROPIC_API_KEY` |
| `gemini` | Google generateContent | `GEMINI_API_KEY` |
| `arkcli` | Local arkcli CLI (Coding Plan) | — (login-based) |
| `mock` | Echo (dev) | — |

**Adding a new provider is zero-code** — just add a `providerOverrides` entry in `config/ai.json`:

```jsonc
"providerOverrides": {
  "deepseek": { "model": "deepseek-reasoner", "baseUrl": "https://my-proxy/v1", "apiKeyEnv": "MY_KEY" }
}
```

Verify your LLM is truly working:

```bash
npm run tsx scripts/llm-integration-test.ts
```

## 📖 Usage

```bash
npm start                                   # production start
npm run dev                                 # dev mode (auto-reload)
npm run seed:whitelist -- "room@chatroom" "群名"   # add a backup whitelist room
curl http://127.0.0.1:3000/api/stats        # stats without opening the browser
```

**Admin dashboard** (http://127.0.0.1:3000/): stats board, message stream, online whitelist & flow config, safety logs, LLM usage.

**Connect real WeChat** — swap the protocol in `.env`:

```bash
WECHATY_PUPPET=wechaty-puppet-service              # paid/stable (needs token)
# WECHATY_PUPPET=wechaty-puppet-wechat4u           # free (ban-risk)
```

Full guide: [docs/connect-real-wechat.md](./docs/connect-real-wechat.md)

## 🧪 Testing

```bash
npm test             # 323 tests
npm run typecheck    # tsc --noEmit
```

---

📦 **Configuration**: [`config/`](./config/) for bot/backup/AI/safety/flows · `.env` for secrets
🐳 **Docker**: `docker build -t wechat-assistant . && docker run -v $(pwd)/data:/app/data wechat-assistant`
📚 **More docs**: [上线前准备](./docs/pre-launch-verification.md) · [阶段 3 联调](./docs/phase3-verification.md)

---

<div align="center">

**⚠️ Disclaimer**: Web WeChat protocols carry account-ban risk. Use at your own risk and prefer a secondary account.

MIT License · Built with [Wechaty](https://github.com/wechaty/wechaty)

</div>
