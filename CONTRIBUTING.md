# 贡献指南

感谢关注本项目！欢迎任何形式的贡献：Bug 报告、文档改进、功能提案、代码 PR。

## 开发环境

- Node.js >= 22（[volta](https://volta.sh) 或 nvm 管理版本）
- npm（项目自带 lockfile）

```bash
git clone https://github.com/anthonyhann/wechat-assistant.git
cd wechat-assistant
npm install
npm test        # 323 个测试应全绿
```

## 开发流程（分支保护已启用）

main 分支受保护：**CI（build + typecheck + test）通过才能合并**，禁止 force push。

```bash
# 1. 从 main 拉功能分支
git checkout -b feat/your-feature

# 2. 开发 + 测试
npm test && npm run typecheck

# 3. 提交并推送
git add -A
git commit -m "feat: 简述改动"
git push -u origin feat/your-feature

# 4. 在 GitHub 上开 PR（模板已备好），CI 绿后合并
```

## 提交信息规范

Conventional Commits 风格（CI 不强制，但请保持）：

```
feat: 新功能
fix: Bug 修复
docs: 文档
refactor: 重构（不改行为）
test: 测试
chore: 构建/工具
ci: CI 配置
```

## 项目约定（重要）

写代码前请了解这些**结构性约束**——评审会卡：

1. **所有对外回复必须经 `SafeSender`**（`src/safety/safe-sender.ts`）。
   `src/` 下除它之外的任何 `.say(` 调用会让守卫测试失败
   （`tests/safe-sender.spec.ts` 的结构性守卫）。
2. **新增 LLM 提供方**：OpenAI 兼容类直接在 `config/ai.json` 的
   `providerOverrides` 加配置即可；全新协议才在 `src/llm/` 写适配器
   并在 `providers.ts` 注册表登记。
3. **改 SQLite schema 必须同步提供老库迁移**（`db.ts` 的 `migrateColumns` /
   `migrateIndexes`），并构造旧 schema 库写回归测试——单测用新库抓不到
   老库升级问题。
4. **测试不依赖 `.env`**：CI 没有 `.env`，不要让断言依赖 `loadConfig()`
   的 provider 具体值（用可控 stub）。
5. **修复 Bug 必须带回归测试**，并做变异验证（回退修复→测试应失败）。

## 目录结构

```
src/
├── bot/          Wechaty 实例与生命周期
├── router/       消息路由（入站安全→备份→流程→AI）
├── backup/       媒体备份（白名单+下载+去重）
├── flow/         关键词流程引擎
├── safety/       安全闸门 + 词库 + SafeSender
├── ai/           AI 模块 + 会话记忆
├── llm/          LLM 适配层（providers 注册表 + 各协议适配器）
├── storage/      SQLite（schema、迁移、DAO、保留清理）
├── admin/        Web 管理台
├── config/       配置加载与校验
└── utils/        logger / file-utils
tests/            Vitest（与 src/ 结构对应）
scripts/          CLI 工具（seed 等）
docs/             深入文档
```

## 报告 Issue

用 GitHub 的 issue 模板（Bug / Feature / 新 LLM 提供方）。
涉及日志请**先脱敏**（API key、token、聊天内容）。
