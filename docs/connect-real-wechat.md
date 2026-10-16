# 接入真实微信：领到 token 后的完整步骤

> 前置：你已经有一个可用的 `WECHATY_PUPPET_SERVICE_TOKEN`（来自 PadLocal / Paimon 等服务商，
> 或 7 天免费试用）。若还没有，见 README「连上真实微信」一节的服务商入口。
>
> 本指南假设你的项目已经能跑通 mock 模式（`npm test` 全绿、管理台能打开）。

## 三种协议，先确认你选的是哪种

| .env 里的 `WECHATY_PUPPET` | 需要什么 | 是否需要云服务器 |
|---|---|---|
| `wechaty-puppet-mock` | 无 | 否（不连真实微信，仅验证逻辑） |
| `wechaty-puppet-wechat4u` | 无（免费 Web 协议） | 否，但有**封号风险** |
| `wechaty-puppet-service` | **付费/试用 token** | **是**（服务商要求，见下方「架构说明」） |

---

## 方案 A：wechaty-puppet-service（PadLocal / Paimon，推荐生产）

### ⚠️ 先理解架构：这不是纯软件，需要云服务器

`wechaty-puppet-service` 的 puppet 服务端**跑在服务商要求的云服务器上**，
你的机器人（跑在本地或任意机器）通过网络连过去。所以你需要：

1. 一台**有国内公网 IP** 的云服务器（阿里云 / 华为云；PadLocal 文档要求放行 **8788 端口**）
2. 服务器上装 Docker
3. 你的 token

> 如果你只有本地机器、没有国内公网 IP，`wechaty-puppet-service` 用不了，
> 只能用方案 B（wechat4u）。

### Step 1：配置 `.env`

```bash
# 协议切到 service
WECHATY_PUPPET=wechaty-puppet-service

# 填入你的 token（**不要提交到 git**，.env 已被 gitignore）
WECHATY_PUPPET_SERVICE_TOKEN=puppet_padlocal_xxxxxxxxxxxxxxxxxx
```

保存后确认：
```bash
grep -E "WECHATY_PUPPET" .env
# 应显示 service + token 两行
```

### Step 2：确认服务端已注册你的 token

PadLocal 的 token 需要在服务端注册（通常你购买时服务商已帮你做好，或按他们的文档在云服务器上跑一次 Docker 容器注册）。

自检方法（浏览器访问，把 xxxx 换成你的 token）：
```
https://api.chatie.io/v0/hosties/puppet_padlocal_xxxx
```
- 返回 `{"ip":"你的公网IP","port":8788}` → ✅ 注册成功
- 返回 `{"ip":"0.0.0.0","port":0}` → ❌ 未注册，需回服务商/服务器 Docker 步骤

### Step 3：启动并扫码

```bash
npm start
```

终端会出现**登录二维码**（ASCII 图形），用**要登录的微信**扫码：
- 首次登录：扫码 + 手机上确认
- 若提示「请先启动 puppet 服务端」→ 检查 Step 2 的 IP 注册

扫码成功后日志会显示 `login: <你的微信名>`。

### Step 4：验证真在收消息

随便给自己或某个群发一条消息，终端应出现：
```
收到消息 <msgId> 来自 私聊[<你的ID>] 类型=1
```

若 AI 已配置（`LLM_PROVIDER` 非 mock），你发「你好」应收到 AI 回复。

### Step 5：加备份白名单（可选）

```bash
# 用真实群 ID（通常形如 xxx@chatroom）
npm run seed:whitelist -- "xxx@chatroom" "我的群名"
```
或在管理台 http://127.0.0.1:3000/ 在线加。

之后该群的图片/文件会自动备份到 `data/media/`。

---

## 方案 B：wechaty-puppet-wechat4u（免费，有封号风险）

不想买 token、没有云服务器，只是想**试试真实微信**：

```bash
# .env
WECHATY_PUPPET=wechaty-puppet-wechat4u
```

然后 `npm start`，同样扫码登录。

> ⚠️ **风险提示**：这是免费 Web 协议，微信官方不认可，账号**有被限制/封禁的风险**。
> 建议用**小号**测试，别用主力微信。生产环境请用方案 A。

---

## 常见问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 启动 exit 1，日志 `Error: no token` | `.env` 是 service 协议但 token 没填 | 填 `WECHATY_PUPPET_SERVICE_TOKEN`，或先切回 mock |
| 一直卡在扫码、扫了没反应 | token 未在服务端注册 | 检查 `api.chatie.io/v0/hosties/...` 返回的 IP |
| `WECHATY_PUPPET_SERVICE_TOKEN` 环境变量读了但连不上 | 云服务器 8788 端口没放行 | 在服务商控制台开放安全组 8788 |
| 扫码后提示「登录环境异常」 | 微信安全策略 | 换网络环境/换小号重试，或联系 token 服务商 |
| 收不到群消息 | 群没加备份白名单 / 机器人被踢 | 加白名单；检查机器人是否还在群里 |

## 切回 mock（不想连真实微信时）

```bash
# .env
WECHATY_PUPPET=wechaty-puppet-mock
```
所有逻辑（AI/备份/安全/管理台）照常工作，只是没有真实消息流。

---

## 重要：token 是密钥

`WECHATY_PUPPET_SERVICE_TOKEN` 和 API key 一样是敏感凭证：
- 只放 `.env`（已被 gitignore），**绝不提交 git**
- 泄露了联系服务商吊销重发
