---
name: 🔌 新 LLM 提供方
about: 请求支持一家新的 LLM 提供方，或报告某家适配器的问题
title: '[LLM] '
labels: ['llm-provider']
assignees: []
---

## 提供方信息

- **名称**：<!-- 如 siliconflow -->
- **协议**：<!-- OpenAI 兼容 / Anthropic 风格 / 其他 -->
- **Base URL**：<!-- 官方 API 端点，如 https://api.siliconflow.cn/v1 -->
- **API Key 环境变量建议名**：<!-- 如 SILICONFLOW_API_KEY -->
- **代表模型**：<!-- 如 deepseek-ai/DeepSeek-V3 -->
- **官方文档**：<!-- 链接 -->

## 已知差异

<!-- 该厂商与标准 OpenAI 协议的差异（鉴权头、响应结构、特殊字段等） -->

## 你是否验证过

- [ ] 我有该厂商的 API key，可以协助联调
- [ ] 我已阅读该厂商的 API 文档

> 💡 如果是 **OpenAI 兼容**厂商，你甚至不需要等代码发布——直接在
> `config/ai.json` 的 `providerOverrides` 里加一条即可使用，详见 README。
