import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, MessageRepository, WhitelistRepository } from '../src/storage/db.js'
import { createAdminServer } from '../src/admin/admin-server.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'

function makeConfig (over: Partial<AppConfig> = {}): AppConfig {
  return {
    bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: true, port: 0, token: '' } },
    backup: { enabled: true, mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100, dedupeByHash: true, saveAllTextMessages: true, timeZone: 'Asia/Shanghai', retentionDays: 30 },
    ai: { provider: 'mock', ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K', temperature: 0.7, maxTokens: 1024 }, openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K' }, memory: { enabled: true, windowSize: 10, ttlMinutes: 30 }, systemPrompt: 'p', throttleSeconds: 10, maxPromptChars: 8000 },
    safety: { localFilter: { enabled: true, wordFile: 'w.txt' }, llmAudit: { enabled: false, provider: 'ark' }, fallbackReply: 'fb', logInterceptions: true },
    flows: [],
    ...over,
  }
}

async function setup (over: Partial<AppConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wc-admin-'))
  const db = createDatabase(join(dir, 't.sqlite'))
  const config = makeConfig(over)
  const server = createAdminServer({ db, config, log: createLogger('AdminTest'), reloadFlows: () => {} })
  await server.start()
  const port = (server as any).port ?? 0
  return { dir, db, server, baseUrl: `http://127.0.0.1:${port}`, cleanup: async () => { await server.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

describe('admin-server API', () => {
  test('GET /api/stats 返回统计结构', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/stats`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('todayMessages')
      expect(body).toHaveProperty('backupFiles')
      expect(body).toHaveProperty('aiCalls')
      expect(body).toHaveProperty('safetyBlocks')
      expect(body).toHaveProperty('usage')
    } finally { await s.cleanup() }
  })

  test('GET /api/messages 返回消息流水', async () => {
    const s = await setup()
    try {
      const repo = new MessageRepository(s.db)
      repo.insert({
        id: 'm1', conversation_id: 'c1', conversation_type: 'room', talker_id: 't1',
        talker_name: '张三', msg_type: 7, text: 'hello', timestamp: 1, is_self: 0,
        handled_by: 'flow', safety_result: null, backup_result: null, flow_result: 'name=F;result=ok', ai_result: null, created_at: 1,
      })
      const res = await fetch(`${s.baseUrl}/api/messages?limit=10`)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].text).toBe('hello')
      expect(body[0].handled_by).toBe('flow')
    } finally { await s.cleanup() }
  })

  test('GET /api/whitelist 返回白名单', async () => {
    const s = await setup()
    try {
      const repo = new WhitelistRepository(s.db)
      repo.add('room-1', '测试群')
      const res = await fetch(`${s.baseUrl}/api/whitelist`)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].room_id).toBe('room-1')
    } finally { await s.cleanup() }
  })

  test('PUT /api/whitelist 新增白名单', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/whitelist`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: 'room-2', roomName: '新群' }),
      })
      expect(res.status).toBe(200)
      const repo = new WhitelistRepository(s.db)
      expect(repo.isEnabled('room-2')).toBe(true)
    } finally { await s.cleanup() }
  })

  test('PUT /api/whitelist 删除白名单（enabled=false）', async () => {
    const s = await setup()
    try {
      const repo = new WhitelistRepository(s.db)
      repo.add('room-1', '测试群')
      const res = await fetch(`${s.baseUrl}/api/whitelist`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: 'room-1', enabled: false }),
      })
      expect(res.status).toBe(200)
      expect(repo.isEnabled('room-1')).toBe(false)
    } finally { await s.cleanup() }
  })

  test('GET /api/flows 返回流程列表', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/flows`)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    } finally { await s.cleanup() }
  })

  test('PUT /api/flows 更新流程并触发热更新', async () => {
    let reloaded = false
    const dir = mkdtempSync(join(tmpdir(), 'wc-admin-'))
    // 该用例会真实写 process.cwd()/config/flows.json（brief 设计如此）——
    // 先保存原内容、结束后还原，避免污染项目自身配置导致 config-loader 测试失败
    const flowsFile = join(process.cwd(), 'config', 'flows.json')
    const originalFlows = readFileSync(flowsFile, 'utf-8')
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const config = makeConfig()
      const server = createAdminServer({ db, config, log: createLogger('T'), reloadFlows: () => { reloaded = true } })
      await server.start()
      const port = (server as any).port ?? 0

      const res = await fetch(`http://127.0.0.1:${port}/api/flows`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flows: [{ name: '新流程', trigger: '测试', scope: 'both', enabled: true, steps: [{ type: 'say', content: 'ok' }] }] }),
      })
      expect(res.status).toBe(200)
      expect(reloaded).toBe(true)

      await server.stop()
      db.close()
    } finally {
      writeFileSync(flowsFile, originalFlows, 'utf-8')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('GET /api/safety-logs 返回拦截记录', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/safety-logs?limit=10`)
      expect(res.status).toBe(200)
      expect(Array.isArray(await res.json())).toBe(true)
    } finally { await s.cleanup() }
  })

  test('GET /api/usage 返回用量聚合', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/usage?days=7`)
      expect(res.status).toBe(200)
      expect(Array.isArray(await res.json())).toBe(true)
    } finally { await s.cleanup() }
  })

  test('GET / 返回 HTML 页面', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      const text = await res.text()
      expect(text).toContain('微信社群个人助理')
    } finally { await s.cleanup() }
  })
})

describe('admin-server 鉴权', () => {
  test('token 为空串时不鉴权（仅本地可用）', async () => {
    const s = await setup()
    try {
      const res = await fetch(`${s.baseUrl}/api/stats`)
      expect(res.status).toBe(200)
    } finally { await s.cleanup() }
  })

  test('token 非空时无 Bearer 头返回 401', async () => {
    const s = await setup({ bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: true, port: 0, token: 'secret-token' } } })
    try {
      const res = await fetch(`${s.baseUrl}/api/stats`)
      expect(res.status).toBe(401)
    } finally { await s.cleanup() }
  })

  test('token 非空时正确 Bearer 头放行', async () => {
    const s = await setup({ bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: true, port: 0, token: 'secret-token' } } })
    try {
      const res = await fetch(`${s.baseUrl}/api/stats`, {
        headers: { authorization: 'Bearer secret-token' },
      })
      expect(res.status).toBe(200)
    } finally { await s.cleanup() }
  })

  test('token 非空时错误 Bearer 头返回 403', async () => {
    const s = await setup({ bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: true, port: 0, token: 'secret-token' } } })
    try {
      const res = await fetch(`${s.baseUrl}/api/stats`, {
        headers: { authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(403)
    } finally { await s.cleanup() }
  })
})
