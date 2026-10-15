import { describe, expect, test } from 'vitest'
import { createMockAdapter, type LlmMessage } from '../src/llm/llm-interface.js'

const user: LlmMessage = { role: 'user', content: '你好' }

describe('mock adapter', () => {
  const mock = createMockAdapter()

  test('name 为 mock', () => {
    expect(mock.name).toBe('mock')
  })

  test('回显最后一条 user 消息', async () => {
    const r = await mock.complete({
      messages: [
        { role: 'system', content: '你是助手' },
        user,
        { role: 'assistant', content: '你好！' },
        { role: 'user', content: '今天天气' },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('[mock] 收到：今天天气')
  })

  test('只有 system 时返回可识别的错误（无 user 输入）', async () => {
    const r = await mock.complete({ messages: [{ role: 'system', content: 's' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('user')
  })

  test('忽略 temperature / maxTokens / model（mock 不需要）', async () => {
    const r = await mock.complete({ messages: [user], temperature: 0.1, maxTokens: 10, model: 'x' })
    expect(r.ok).toBe(true)
  })

  test('空 messages 返回错误而非抛错', async () => {
    const r = await mock.complete({ messages: [] })
    expect(r.ok).toBe(false)
  })

  test('中文与 emoji 内容原样回显', async () => {
    const r = await mock.complete({ messages: [{ role: 'user', content: '你好😀 test' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toContain('你好😀 test')
  })
})
