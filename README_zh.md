<div align="center">

# 🤖 wechat-assistant

### 自托管微信社群助手：每条外发消息先过安全闸门。

消息备份 · 关键词自动回复 · AI 对话 · 内容安全 · Web 管理台。TypeScript + Wechaty + SQLite，**323 个测试**全绿，**12 家 LLM 提供方**，零遥测。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![版本](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](package.json)
[![测试](https://img.shields.io/badge/tests-323%20passing-brightgreen?style=flat-square)](#-真实数字)
[![LLM 提供方](https://img.shields.io/badge/LLM%20providers-12-purple?style=flat-square)](#-llm-提供方)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Stars](https://img.shields.io/github/stars/anthonyhann/wechat-assistant?style=flat-square)](https://github.com/anthonyhann/wechat-assistant/stargazers)

[快速上手](#-快速上手) · [功能](#-它能做什么) · [隐私](#-隐私与数据流向) · [真实数字](#-真实数字) · [什么时候别用](#-什么时候别用它) · [English](README.md)

</div>

---

## 😮‍💨 你是不是也这样？

- 群里的图片文件**过期就被清理**，真要找的时候早没了。
- 同样的问题**每天被问十遍**，你只能一遍遍复制粘贴同一个答案。
- 想让 AI 替你回消息，又怕它在客户面前乱说话。
- 不想让自己社群的消息经过任何第三方 SaaS。

wechat-assistant 跑在**你自己的机器上**：基于 Wechaty 的机器人，自动备份群媒体、按关键词流程应答、用你选的 LLM 对话——并且每条外发回复都先过本地安全闸门。

**首次启动长这样**（默认 mock 模式，不需要真实微信号）：

```text
加载配置完成，机器人名: wechat-assistant
数据库已就绪: data/wechat-assistant.sqlite
管理台已启动 http://127.0.0.1:3000
机器人已启动
wechat-assistant 已就绪
```

## 🚀 快速上手

**1 · 安装并配置**

```bash
git clone https://github.com/anthonyhann/wechat-assistant.git
cd wechat-assistant
npm install && cp .env.example .env   # .env 已按 mock 模式预填好
```

**2 · 启动**

```bash
npm start
```

**3 · 打开管理台** —— http://127.0.0.1:3000/（统计看板、消息流水、白名单/流程在线配置、安全日志、LLM 用量）。

**给 AI agent 的口令** —— 粘贴给你的 coding agent：

> 克隆 https://github.com/anthonyhann/wechat-assistant，执行 `npm install && cp .env.example .env && npm test`，然后以 mock 模式启动。

mock 模式不连真实微信，就能验证 AI / 备份 / 安全 / 管理台全部逻辑。准备好后见 [连接真实微信](docs/connect-real-wechat.md)（改一行环境变量，扫码登录）。

## ✨ 它能做什么

| 能力 | 触发方式 | 说明 |
|---|---|---|
| 💾 **消息备份** | 自动（白名单群） | 图片/文件存到 `data/media/{群}/{日期}/`，sha256 去重，超 100 MB 不下载 |
| 🤖 **AI 对话** | 私聊随时；群内需 **@机器人** | 12 家 LLM 提供方多轮对话，10 轮/30 分钟记忆窗口，单用户 10 秒节流 |
| 💬 **关键词自动回复** | 命中触发词 | 配置驱动的流程引擎（`config/flows.json`）——多步回复、转人工 |
| 🛡️ **内容安全闸门** | 自动（每条外发回复） | 614 词本地词库五分类 + prompt 注入防护，命中即换兜底话术 |
| 📊 **Web 管理台** | 浏览器 | 统计看板、消息流水、白名单/流程在线改（热生效）、安全日志、LLM 用量——9 个 API 路由 |
| 🔒 **数据保留** | 自动（启动时） | 超 30 天的消息/日志自动清理（可配） |

## 🏗️ 架构

```text
微信 → 机器人 (Wechaty) → 消息路由 ──┬──▶ 备份模块   （白名单 + 下载 + sha256 去重）
                                     ├──▶ 流程引擎   （关键词匹配 + 多步执行）
                                     ├──▶ 安全闸门   （L1 词库 + L3 兜底）
                                     └──▶ AI 模块    （记忆 + 节流 + LLM 适配器）
                                                   │
                           12 个适配器：mock · deepseek · qwen · glm · kimi · doubao
                                        minimax · baichuan · openai · claude · gemini · arkcli
```

每条外发消息过三层防线：**L1** 本地词库（常开、零成本）→ **L2** LLM 语义审核（可选，默认关）→ **L3** 兜底话术（常开）。

## 📊 真实数字

| 指标 | 数值 | 出处 |
|---|---|---|
| 测试 | **323** 个，28 个文件 | `npm test`（vitest，全绿） |
| LLM 提供方 | **12** 家（11 真实 + mock） | [src/llm/providers.ts](src/llm/providers.ts) |
| 本地敏感词库 | **614** 词，五分类 + 注入特征 | [config/sensitive-words.txt](config/sensitive-words.txt) |
| 管理台 API | **9** 个路由 + 看板页 | [src/admin/admin-server.ts](src/admin/admin-server.ts) |
| AI 记忆窗口 | **10 轮 / 30 分钟** | [config/ai.json](config/ai.json) |
| 备份限制 | 单文件 **100 MB**，sha256 去重 | [config/backup.json](config/backup.json) |
| 数据保留 | **30 天**，启动时自动清理 | [config/backup.json](config/backup.json) |
| 源码规模 | **24** 个 TypeScript 模块 | [src/](src/) |

## 🤖 LLM 提供方

在 `.env` 里设置 `LLM_PROVIDER` 即可——每家都带 preset 默认值（baseUrl / model / key 环境变量）：

| 提供方 | 协议 | key 环境变量 |
|---|---|---|
| `deepseek` | OpenAI 兼容 | `DEEPSEEK_API_KEY` |
| `qwen`（通义） | OpenAI 兼容 | `DASHSCOPE_API_KEY` |
| `glm`（智谱） | OpenAI 兼容 | `ZHIPU_API_KEY` |
| `kimi`（月之暗面） | OpenAI 兼容 | `MOONSHOT_API_KEY` |
| `doubao`（豆包，别名 `ark`） | OpenAI 兼容 | `ARK_API_KEY` |
| `minimax` | OpenAI 兼容 | `MINIMAX_API_KEY` |
| `baichuan`（百川） | OpenAI 兼容 | `BAICHUAN_API_KEY` |
| `openai` | OpenAI 兼容 | `OPENAI_API_KEY` |
| `claude` | Anthropic Messages | `ANTHROPIC_API_KEY` |
| `gemini` | Google generateContent | `GEMINI_API_KEY` |
| `arkcli` | 本机 arkcli CLI（登录态） | — |
| `mock` | 回显（开发用） | — |

**新增一家 OpenAI 兼容厂商是零代码**——只需在 `config/ai.json` 加一条：

```jsonc
"providerOverrides": {
  "deepseek": { "model": "deepseek-reasoner", "baseUrl": "https://my-proxy.example/v1", "apiKeyEnv": "MY_KEY" }
}
```

端到端验证你的 LLM（连通性、用量记录、安全拦截、多轮记忆、节流五项全检）：

```bash
npm run tsx scripts/llm-integration-test.ts
```

## 🔐 隐私与数据流向

以下以代码实际行为为准，不是宣传话术：

- **一切数据留在本机。** 消息与媒体存在 `data/wechat-assistant.sqlite` 和 `data/media/`。代码里**没有遥测、没有统计上报、没有任何追踪调用**（可 grep 验证）。
- **仅有的外发流量**是：(a) 微信协议连接本身；(b) AI 对话被调用时，发送给**你自己配置的 LLM 厂商 API** 的消息。选 `mock` 则完全没有外发。
- **管理台只绑定 `127.0.0.1`**——网络侧不可达，除非你自己做隧道；可用 `config/bot.json` 开启 Bearer 鉴权。
- **自动保留策略**：超 30 天的消息/日志启动时清理（可配）。
- **API key** 只放 `.env`（已 gitignore），不进配置文件。

## 📁 目录结构

```text
wechat-assistant/
├── src/
│   ├── bot/            # Wechaty 机器人生命周期
│   ├── router/         # 消息路由：备份 / 流程 / 安全 / AI
│   ├── backup/         # 媒体下载 + sha256 去重
│   ├── flow/           # 关键词流程引擎（多步、转人工）
│   ├── safety/         # L1 词库 + 安全发送 + 闸门
│   ├── ai/             # AI 模块 + 记忆窗口
│   ├── llm/            # 12 家提供方适配器 + 注册表
│   ├── admin/          # Express 管理台（9 个 API，仅回环）
│   ├── storage/        # SQLite（better-sqlite3）+ 保留期清理
│   └── config/         # Zod 校验的配置加载器
├── config/             # bot / backup / ai / safety / flows 配置 + 敏感词库
├── scripts/            # 白名单导入、LLM 联调测试
├── tests/              # 323 个测试（vitest）
├── docs/               # 真实微信接入 + 各阶段验证文档
├── Dockerfile          # 多阶段构建，node:24-alpine
└── .env.example        # 有注释，默认 mock 模式
```

## 🐳 Docker

```bash
docker build -t wechat-assistant .
docker run -v $(pwd)/data:/app/data -v $(pwd)/config:/app/config -v $(pwd)/.env:/app/.env wechat-assistant
```

> 管理台只绑容器内回环——`-p 3000:3000` 映射了也访问不到。用 `docker exec`、宿主机直连或 SSH 隧道，详见 [docs/](docs/)。

## ⚠️ 什么时候别用它

- **你需要零封号保证。** Web 协议 puppet（如 wechat4u）有账号被限制的风险。用小号，或付费换 `wechaty-puppet-service`——但没有任何 puppet 能承诺绝对安全。
- **你要的是企业微信（WeCom）。** 这是基于 Wechaty 的个人微信机器人，不是企业微信 API。
- **你需要多账号 / 多租户 SaaS。** 它是单账号、单实例的个人助理。
- **你想要托管云服务。** 没有云版本——你自己跑，数据你自己持有。
- **你想让 AI 裸奔直连外发。** 永远别把 LLM 直接接到外发回复上；L1/L3 两层防线存在的原因就是 LLM 会幻觉、会被注入。

## 🧪 开发

```bash
npm test             # 323 个测试
npm run typecheck    # tsc --noEmit
npm run dev          # tsx watch 自动重载
```

欢迎贡献——见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。如果它救回了你社群的消息（和你的 sanity），**点个 star**，后续更新第一时间知道。

> **项目状态**：v0.1.0，pre-1.0，73 个提交，作者日常在用。mock 模式稳定；wechat4u 路径有上述封号风险。

## License

MIT © [anthonyhann](https://github.com/anthonyhann) —— 详见 [LICENSE](LICENSE)。基于 [Wechaty](https://github.com/wechaty/wechaty) 构建。
