import { describe, expect, test, vi } from 'vitest'
import { createAiModule } from '../src/ai/ai-module.js'
import { createMemoryWindow } from '../src/ai/memory.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'
import type { LlmAdapter } from '../src/llm/llm-interface.js'
import type { SafeSender } from '../src/safety/safe-sender.js'

const FALLBACK = '这个问题我暂时无法回答，我们可以聊聊别的～'
const AI: AppConfig['ai'] = {
  provider: 'mock',
  ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K', temperature: 0.7, maxTokens: 1024 },
  openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K' },
  memory: { enabled: true, windowSize: 10, ttlMinutes: 30 },
  systemPrompt: 'p',
  throttleSeconds: 10,
  maxPromptChars: 8000,
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
  const log = createLogger('ThrottleTest')
  const complete = vi.fn(async () => llmResult)
  const llm: LlmAdapter = { name: 'stub', complete }
  const sender = stubSender(sent)
  const mod = createAiModule({
    llm, memory, log, config: { ...AI, ...over }, fallbackReply: FALLBACK,
    usageRepo: { insert: () => {} } as any,
  })
  return { sent, memory, complete, mod, sender }
}

describe('AI 节流', () => {
  test('同一对话在节流窗口内第二次调用被跳过', async () => {
    const s = setup({ ok: true, text: '回复' })
    await s.mod.chat('c1', '第一句', s.sender)
    const r2 = await s.mod.chat('c1', '第二句', s.sender)
    expect(s.complete).toHaveBeenCalledTimes(1)
    expect(r2.reason).toBe('throttled')
  })

  test('不同对话互不影响', async () => {
    const s = setup({ ok: true, text: '回复' })
    await s.mod.chat('c1', 'a', s.sender)
    await s.mod.chat('c2', 'b', s.sender)
    expect(s.complete).toHaveBeenCalledTimes(2)
  })

  test('throttleSeconds=0 时不节流', async () => {
    const s = setup({ ok: true, text: '回复' }, { throttleSeconds: 0 })
    await s.mod.chat('c1', 'a', s.sender)
    await s.mod.chat('c1', 'b', s.sender)
    expect(s.complete).toHaveBeenCalledTimes(2)
  })
})

describe('prompt 截断', () => {
  test('超长用户消息被截断到 maxPromptChars', async () => {
    const s = setup({ ok: true, text: 'x' }, { maxPromptChars: 100 })
    const longText = 'a'.repeat(500)
    await s.mod.chat('c1', longText, s.sender)
    const userMsg = s.complete.mock.calls[0]![0].messages.findLast((m: any) => m.role === 'user')
    expect(userMsg!.content.length).toBeLessThanOrEqual(100)
  })

  // 回归：本轮消息占满预算时，历史硬顶不能失效（原 budget>0 守卫会整体跳过裁剪）
  test('本轮消息占满预算时丢弃全部历史（不整体失效）', async () => {
    const s = setup({ ok: true, text: 'x' }, { maxPromptChars: 200, systemPrompt: 's'.repeat(50) })
    // 历史 10 条，每条 50 字符
    for (let i = 0; i < 10; i++) {
      s.memory.append('c1', { role: 'user', content: 'b'.repeat(50), at: Date.now() })
    }
    // 本轮 250 字符 > maxChars 200 → 截断到 200；system 50 → budget 为负
    const longMsg = 'a'.repeat(250)
    await s.mod.chat('c1', longMsg, s.sender)
    const messages = s.complete.mock.calls[0]![0].messages
    // 只剩 system + 本轮 user，无历史
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toBe(longMsg.slice(0, 200))  // 仍被截断
  })

  test('历史窗口总字符超限时淘汰最旧轮次', async () => {
    const s = setup({ ok: true, text: 'x' }, { maxPromptChars: 200, memory: { enabled: true, windowSize: 10, ttlMinutes: 30 } })
    // 手动塞入大量历史
    for (let i = 0; i < 10; i++) {
      s.memory.append('c1', { role: 'user', content: 'b'.repeat(50), at: Date.now() })
    }
    await s.mod.chat('c1', '新问题', s.sender)
    const messages = s.complete.mock.calls[0]![0].messages
    const totalChars = messages.reduce((sum: number, m: any) => sum + m.content.length, 0)
    expect(totalChars).toBeLessThanOrEqual(200 + '新问题'.length)
  })
})

describe('memory.enabled', () => {
  test('memory.enabled=false 时不读写记忆', async () => {
    // throttleSeconds: 0 —— 本用例验证的是记忆接线，不是节流；
    // 沿用 AI 基座的 10s 会让第二次 chat 被节流，mock.calls[1] 不存在
    const s = setup({ ok: true, text: 'x' }, { memory: { enabled: false, windowSize: 10, ttlMinutes: 30 }, throttleSeconds: 0 })
    await s.mod.chat('c1', '第一句', s.sender)
    await s.mod.chat('c1', '第二句', s.sender)
    // 第二次调用不应含历史（记忆被禁用）
    const messages = s.complete.mock.calls[1]![0].messages
    expect(messages).toHaveLength(2) // system + 本轮 user
    // 记忆也不应被写入
    expect(s.memory.get('c1')).toEqual([])
  })
})
