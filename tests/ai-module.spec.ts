import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAiModule } from '../src/ai/ai-module.js'
import { createMemoryWindow } from '../src/ai/memory.js'
import { createLogger } from '../src/utils/logger.js'
import { createDatabase, UsageRepository } from '../src/storage/db.js'
import type { AppConfig } from '../src/config/config-loader.js'
import type { LlmAdapter } from '../src/llm/llm-interface.js'
import type { SafeSender } from '../src/safety/safe-sender.js'

const FALLBACK = '这个问题我暂时无法回答，我们可以聊聊别的～'
const AI: AppConfig['ai'] = {
  provider: 'mock',
  ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K', temperature: 0.7, maxTokens: 1024 },
  openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K' },
  memory: { enabled: true, windowSize: 10, ttlMinutes: 30 },
  systemPrompt: '你是微信群个人助理',
}

function stubAdapter (r: any): LlmAdapter {
  return { name: 'stub', complete: async () => r }
}

function stubSender (sent: string[]) {
  const sender: SafeSender = {
    send: async (t: string) => { sent.push(t); return true },
    sendImage: async () => {},
    sendFileBox: async () => {},
  }
  return sender
}

function setup (llmResult: any, over: Partial<AppConfig['ai']> = {}) {
  const sent: string[] = []
  const memory = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
  const log = createLogger('AiTest')
  const complete = vi.fn(async () => llmResult)
  const llm: LlmAdapter = { name: 'stub', complete }
  const sender = stubSender(sent)
  const mod = createAiModule({
    llm, memory, log, config: { ...AI, ...over }, fallbackReply: FALLBACK,
  })
  return { sent, memory, log, complete, mod, sender }
}

describe('aiModule.chat 成功路径', () => {
  test('LLM 回复经 sender 发出', async () => {
    const s = setup({ ok: true, text: '今天天气很好' })
    const r = await s.mod.chat('c1', '今天天气怎么样', s.sender)
    expect(r).toEqual({ replied: true, reason: 'ok' })
    expect(s.sent).toEqual(['今天天气很好'])
  })

  test('prompt 含 system prompt + 用户输入', async () => {
    const s = setup({ ok: true, text: 'x' })
    await s.mod.chat('c1', '你好', s.sender)
    const messages = s.complete.mock.calls[0]![0].messages
    expect(messages[0]).toEqual({ role: 'system', content: '你是微信群个人助理' })
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '你好' })
  })

  test('temperature / maxTokens 来自配置', async () => {
    const s = setup({ ok: true, text: 'x' }, { ark: { ...AI.ark, temperature: 0.3, maxTokens: 512 } })
    await s.mod.chat('c1', 'hi', s.sender)
    const req = s.complete.mock.calls[0]![0]
    expect(req.temperature).toBe(0.3)
    expect(req.maxTokens).toBe(512)
  })

  test('记忆写入 user 与 assistant 两轮', async () => {
    const s = setup({ ok: true, text: '回复内容' })
    await s.mod.chat('c1', '问题', s.sender)
    const turns = s.memory.get('c1')
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(turns[1]!.content).toBe('回复内容')
  })

  test('多轮对话时历史进入 prompt', async () => {
    const s = setup({ ok: true, text: 'r1' })
    await s.mod.chat('c1', '第一句', s.sender)
    s.complete.mockClear()
    await s.mod.chat('c1', '第二句', s.sender)
    const messages = s.complete.mock.calls[0]![0].messages
    // system + 上一轮 user + 上一轮 assistant + 本轮 user
    expect(messages).toHaveLength(4)
    expect(messages[1]).toEqual({ role: 'user', content: '第一句' })
    expect(messages[2]).toEqual({ role: 'assistant', content: 'r1' })
    expect(messages[3]).toEqual({ role: 'user', content: '第二句' })
  })

  test('不同会话记忆隔离', async () => {
    const s = setup({ ok: true, text: 'r' })
    await s.mod.chat('c1', 'a', s.sender)
    await s.mod.chat('c2', 'b', s.sender)
    const m2 = s.complete.mock.calls[1]![0].messages
    // c2 的 prompt 不应含 c1 的历史
    expect(m2.map((x: any) => x.content)).not.toContain('a')
  })
})

describe('aiModule.chat 出口被拦', () => {
  test('回复被安全闸门拦下时 reason 记为 blocked（而非 ok）', async () => {
    const sent: string[] = []
    const blockingSender = {
      send: async (t: string) => { sent.push(t); return false },
      sendImage: async () => {}, sendFileBox: async () => {},
    }
    const memory = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    const mod = createAiModule({
      llm: stubAdapter({ ok: true, text: '含敏感词的回复' }), memory,
      sender: blockingSender as any, log: createLogger('AiTest'),
      config: AI, fallbackReply: FALLBACK,
    })
    const r = await mod.chat('c1', 'hi', blockingSender as any)
    expect(r.reason).toBe('blocked')
    expect(r.replied).toBe(true)
    // 记忆仍记录两轮（LLM 确实生成了回复，只是出口被拦）
    expect(memory.get('c1').map(t => t.role)).toEqual(['user', 'assistant'])
  })
})

describe('aiModule.chat 失败路径', () => {
  test('LLM 失败时回复兜底话术', async () => {
    const s = setup({ ok: false, error: 'HTTP 500', retryable: true })
    const r = await s.mod.chat('c1', 'hi', s.sender)
    expect(r.replied).toBe(true)
    expect(r.reason).toBe('llm_failed')
    expect(s.sent[0]).toContain(FALLBACK)
  })

  test('LLM 失败时附带转人工提示', async () => {
    const s = setup({ ok: false, error: 'timeout', retryable: true })
    await s.mod.chat('c1', 'hi', s.sender)
    expect(s.sent[0]).toContain('人工')
  })

  test('LLM 失败时只记 user 轮（不把失败写进历史）', async () => {
    const s = setup({ ok: false, error: 'x', retryable: true })
    await s.mod.chat('c1', '问题', s.sender)
    expect(s.memory.get('c1').map(t => t.role)).toEqual(['user'])
  })

  test('空回复视为失败', async () => {
    const s = setup({ ok: true, text: '' })
    const r = await s.mod.chat('c1', 'hi', s.sender)
    expect(r.reason).toBe('llm_failed')
    expect(s.sent[0]).toContain(FALLBACK)
  })

  test('失败路径也走 sender（兜底话术仍过闸门）', async () => {
    const s = setup({ ok: false, error: 'x', retryable: false })
    await s.mod.chat('c1', 'hi', s.sender)
    expect(s.sent).toHaveLength(1)
  })
})

describe('aiModule.chat usage 落库', () => {
  test('LLM 调用后落 usage_logs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-usage-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const usageRepo = new UsageRepository(db)
      const sent: string[] = []
      const memory = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
      const mod = createAiModule({
        llm: stubAdapter({ ok: true, text: '回复', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
        memory, sender: stubSender(sent), log: createLogger('T'),
        config: AI, fallbackReply: FALLBACK, usageRepo,
      })
      await mod.chat('c1', 'hi', stubSender(sent))
      const row = db.prepare('SELECT * FROM usage_logs').get() as any
      expect(row.provider).toBe('mock')
      expect(row.total_tokens).toBe(15)
      expect(row.ok).toBe(1)
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('LLM 失败也落 usage_logs（ok=0）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-usage-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const usageRepo = new UsageRepository(db)
      const sent: string[] = []
      const memory = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
      const mod = createAiModule({
        llm: stubAdapter({ ok: false, error: 'HTTP 500', retryable: true }),
        memory, sender: stubSender(sent), log: createLogger('T'),
        config: AI, fallbackReply: FALLBACK, usageRepo,
      })
      await mod.chat('c1', 'hi', stubSender(sent))
      const row = db.prepare('SELECT * FROM usage_logs').get() as any
      expect(row.ok).toBe(0)
      expect(row.error).toBe('HTTP 500')
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
