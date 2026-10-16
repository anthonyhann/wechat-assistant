# 安全策略

## 支持版本

| 版本 | 支持状态 |
|------|---------|
| 最新 main | ✅ 支持 |
| 其他 | ❌ |

## 报告漏洞

**请不要在公开 Issue 中报告安全漏洞。**

使用 [GitHub Private Vulnerability Reporting](https://github.com/anthonyhann/wechat-assistant/security/advisories/new) 私密报告，或通过仓库主页联系维护者。

报告时请包含：

1. 漏洞类型与影响面（如「API key 泄漏路径」「未授权访问」）
2. 复现步骤或 PoC
3. 受影响的代码位置（文件:行号）
4. 修复建议（如有）

我们会在 72 小时内确认收到，修复发布前对细节保密。

## 本项目的安全设计要点（供审计参考）

- **密钥管理**：所有密钥只走 `.env`（已 gitignore）；适配器错误信息不回显
  API key（见 `src/llm/llm-interface.ts` 的 postJson）
- **出站收口**：所有对外消息必经 `SafeSender` → 内容安全闸门
  （`src/safety/safe-sender.ts` + `safety-gate.ts`），结构性守卫测试强制
- **管理台**：仅绑定 `127.0.0.1`；可选 Bearer token；看板输出经 HTML 转义；
  flows 写入前经 zod 校验 + 原子写
- **SQL**：全部参数化查询；动态列名走白名单校验（`MessageRepository.setResult`）；
  迁移用标识符校验（`assertIdentifier`）

## 已知边界（非漏洞，使用须知）

- 管理台绑定回环，但 `docker run` 场景下容器内回环与宿主机端口映射的
  交互需自行理解（见 README Docker 一节）
- Web 微信协议（wechat4u）本身有账号风控风险
- L1 词库为子串匹配，存在误拦（fails safe 方向）与漏拦（新变体）可能；
  建议结合业务持续维护词库
