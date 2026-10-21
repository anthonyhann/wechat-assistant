<div align="center">

# 🤖 wechat-assistant

### A self-hosted WeChat group assistant — every outbound reply passes a safety gate.

Message backup · keyword auto-reply · AI chat · content safety · web admin console. TypeScript + Wechaty + SQLite, **323 tests** green, **12 LLM providers**, zero telemetry.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-323%20passing-brightgreen?style=flat-square)](#-the-numbers)
[![LLM Providers](https://img.shields.io/badge/LLM%20providers-12-purple?style=flat-square)](#-llm-providers)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Stars](https://img.shields.io/github/stars/anthonyhann/wechat-assistant?style=flat-square)](https://github.com/anthonyhann/wechat-assistant/stargazers)

[Quickstart](#-quickstart) · [Features](#-what-it-does) · [Privacy](#-privacy--data-flow) · [Numbers](#-the-numbers) · [When NOT to Use](#-when-not-to-use-it) · [中文](README_zh.md)

</div>

---

## 😮‍💨 Sound familiar?

- Photos and files in your groups **expire and vanish** — when you finally need them, they're gone.
- The same questions get asked **ten times a day** — and you keep copy-pasting the same answer.
- You'd love an AI replying for you, but you're afraid of what it might say to your customers.
- You don't want your community's messages flowing through someone else's SaaS.

wechat-assistant runs **on your own machine**: a Wechaty bot that backs up group media, answers by keyword flows, chats via your choice of LLM — and forces every single outbound reply through a local safety gate first.

**First run looks like this** (default mock mode — no real WeChat account needed):

```text
加载配置完成，机器人名: wechat-assistant
数据库已就绪: data/wechat-assistant.sqlite
管理台已启动 http://127.0.0.1:3000
机器人已启动
wechat-assistant 已就绪
```

## 🚀 Quickstart

**1 · Install & configure**

```bash
git clone https://github.com/anthonyhann/wechat-assistant.git
cd wechat-assistant
npm install && cp .env.example .env   # .env ships pre-configured for mock mode
```

**2 · Start**

```bash
npm start
```

**3 · Open the admin console** — http://127.0.0.1:3000/ (stats board, message stream, whitelist & flow config, safety logs, LLM usage).

**For AI agents** — paste this to your coding agent:

> Clone https://github.com/anthonyhann/wechat-assistant, then run `npm install && cp .env.example .env && npm test` and start it in mock mode.

Mock mode verifies every module — AI, backup, safety, dashboard — without touching a real account. When you're ready: [Connecting Real WeChat](docs/connect-real-wechat.md) (swap one env var, scan a QR code).

## ✨ What It Does

| Feature | Trigger | What it does |
|---|---|---|
| 💾 **Message Backup** | Auto (whitelisted rooms) | Saves images & files to `data/media/{room}/{date}/`, sha256 dedup, skips files > 100 MB |
| 🤖 **AI Chat** | DMs anytime · rooms need **@bot** | Multi-turn chat via 12 LLM providers, 10-turn / 30-min memory window, per-user 10 s throttle |
| 💬 **Keyword Auto-Reply** | Trigger-word match | Config-driven flow engine (`config/flows.json`) — multi-step replies, human handoff |
| 🛡️ **Content Safety Gate** | Auto (every outbound reply) | 614-word local blocklist across 5 categories + prompt-injection defense; blocked replies get a safe fallback |
| 📊 **Web Admin Console** | Browser | Stats board, message stream, online whitelist/flow editing (hot-reload), safety logs, LLM usage — 9 API routes |
| 🔒 **Data Retention** | Auto (on startup) | Messages / logs older than 30 days are auto-purged (configurable) |

## 🏗️ Architecture

```text
WeChat → Bot (Wechaty) → Message Router ──┬──▶ Backup Module   (whitelist + download + sha256 dedup)
                                          ├──▶ Flow Engine     (keyword match + multi-step execution)
                                          ├──▶ Safety Gate     (L1 blocklist + L3 fallback)
                                          └──▶ AI Module       (memory + throttle + LLM adapters)
                                                        │
                              12 adapters: mock · deepseek · qwen · glm · kimi · doubao
                                           minimax · baichuan · openai · claude · gemini · arkcli
```

Three-layer defense for every outbound message: **L1** local blocklist (always on, zero cost) → **L2** LLM semantic audit (optional, off by default) → **L3** safe fallback reply (always on).

## 📊 The Numbers

| Metric | Value | Source |
|---|---|---|
| Tests | **323** across 28 files | `npm test` (vitest, all green) |
| LLM providers | **12** (11 real + mock) | [src/llm/providers.ts](src/llm/providers.ts) |
| Local blocklist | **614** words, 5 categories + injection patterns | [config/sensitive-words.txt](config/sensitive-words.txt) |
| Admin API routes | **9** + dashboard page | [src/admin/admin-server.ts](src/admin/admin-server.ts) |
| AI memory window | **10 turns / 30 min** | [config/ai.json](config/ai.json) |
| Backup limits | **100 MB** per file, sha256 dedup | [config/backup.json](config/backup.json) |
| Data retention | **30 days**, auto-purged on startup | [config/backup.json](config/backup.json) |
| Source size | **24** TypeScript modules | [src/](src/) |

## 🤖 LLM Providers

Set `LLM_PROVIDER` in `.env` — every provider ships with sane presets (baseUrl / model / key env var):

| Provider | Protocol | Key env var |
|---|---|---|
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
| `arkcli` | Local arkcli CLI (login-based) | — |
| `mock` | Echo (dev) | — |

**Adding an OpenAI-compatible provider is zero-code** — one entry in `config/ai.json`:

```jsonc
"providerOverrides": {
  "deepseek": { "model": "deepseek-reasoner", "baseUrl": "https://my-proxy.example/v1", "apiKeyEnv": "MY_KEY" }
}
```

Verify your LLM end-to-end (connectivity, usage logging, safety interception, memory, throttle):

```bash
npm run tsx scripts/llm-integration-test.ts
```

## 🔐 Privacy & Data Flow

Verified against the code, not just promised:

- **Everything stays on your machine.** Messages and media live in `data/wechat-assistant.sqlite` and `data/media/`. The codebase contains **no telemetry, no analytics, no tracking calls**.
- **The only outbound traffic** is (a) the WeChat protocol connection itself, and (b) messages sent to **your chosen LLM provider's API** when AI chat is invoked. Choose `mock` and nothing leaves the box at all.
- **Admin console binds `127.0.0.1` only** — not reachable from the network unless you tunnel it; optional Bearer-token auth via `config/bot.json`.
- **Auto-retention**: messages/logs older than 30 days are purged on startup (configurable).
- **API keys** live in `.env` (git-ignored), never in config files.

## 📁 What's Inside

```text
wechat-assistant/
├── src/
│   ├── bot/            # Wechaty bot lifecycle
│   ├── router/         # Message routing: backup / flow / safety / AI
│   ├── backup/         # Media download + sha256 dedup
│   ├── flow/           # Keyword flow engine (multi-step, handoff)
│   ├── safety/         # L1 blocklist + safe sender + gate
│   ├── ai/             # AI module + memory window
│   ├── llm/            # 12 provider adapters + registry
│   ├── admin/          # Express admin console (9 API routes, loopback-only)
│   ├── storage/        # SQLite (better-sqlite3) + retention
│   └── config/         # Zod-validated config loader
├── config/             # bot / backup / ai / safety / flows JSON + sensitive-words.txt
├── scripts/            # whitelist seeding, LLM integration test
├── tests/              # 323 tests (vitest)
├── docs/             # Real-WeChat connection + verification guides
├── Dockerfile          # Multi-stage, node:24-alpine
└── .env.example        # Documented, mock-mode default
```

## 🐳 Docker

```bash
docker build -t wechat-assistant .
docker run -v $(pwd)/data:/app/data -v $(pwd)/config:/app/config -v $(pwd)/.env:/app/.env wechat-assistant
```

> The admin server binds the container's loopback — `-p 3000:3000` won't expose it. Use `docker exec`, host deployment, or an SSH tunnel. See [docs/](docs/).

## ⚠️ When NOT to Use It

- **You need a zero-ban-risk guarantee.** Web-protocol puppets (e.g. wechat4u) can get an account restricted. Use a secondary account, or pay for `wechaty-puppet-service` — but no puppet can promise absolute safety.
- **You want 企业微信 (WeCom).** This bot is for personal WeChat via Wechaty, not the enterprise API.
- **You need multi-account or multi-tenant SaaS.** It's a single-account, single-instance assistant.
- **You want a hosted service.** There is no cloud version — you run it, you own the data.
- **You expect the AI to be safe without the gate.** Never wire an LLM straight to outbound replies; the L1/L3 layers exist because LLMs hallucinate and get prompt-injected.

## 🧪 Development

```bash
npm test             # 323 tests
npm run typecheck    # tsc --noEmit
npm run dev          # tsx watch, auto-reload
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). If this saved your community's messages (and your sanity), **star the repo** to follow what lands next.

> **Project status**: v0.1.0, pre-1.0, 73 commits, in active daily use. Mock mode is stable; the wechat4u path carries the ban risk noted above.

## License

MIT © [anthonyhann](https://github.com/anthonyhann) — see [LICENSE](LICENSE). Built with [Wechaty](https://github.com/wechaty/wechaty).
