<!-- 标题格式建议：feat: xxx / fix: xxx / docs: xxx / refactor: xxx -->

## 概述

<!-- 一两句话说明这个 PR 做了什么、为什么 -->

## 改动类型

- [ ] ✨ 新功能（feat）
- [ ] 🐛 Bug 修复（fix）
- [ ] 📝 文档（docs）
- [ ] ♻️ 重构（refactor）
- [ ] 🧪 测试（test）
- [ ] 🔧 构建/CI（chore/ci）

## 相关 Issue

<!-- 如 Closes #123；没有就删掉本节 -->

## 自查清单

- [ ] `npm test` 全绿
- [ ] `npm run typecheck` 无错误
- [ ] 新增/修改的代码有对应测试
- [ ] 涉及对外回复的改动**经过了 SafeSender**（结构性守卫测试会检查 `.say(` 出口）
- [ ] 涉及配置结构的改动同步更新了 `config/*.json` 与 `.env.example`
- [ ] 文档（README / docs/）已同步

## 给 Reviewer 的说明

<!-- 需要重点看哪里、有什么取舍 -->
