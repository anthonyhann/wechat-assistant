import { describe, expect, test, vi } from 'vitest'
import { createAnthropicAdapter } from '../src/llm/anthropic-adapter.js'

function fakeFetch (opts: { status?: number; json?: any; throw?: Error }) {
  return vi.fn(async () => {
    if (opts.throw) throw opts.throw
    return new Response(JSON.stringify(opts.json ?? {}), { status: opts.status ?? 200 })
  }) as any
}

function make (fetchImpl: any) {
  return createAnthropicAdapter({
    apiKey: 'test-key', model: 'claude-sonnet-4-5',
    baseUrl: 'https://api.anthropic.com/v1', fetchImpl,
  })
}

describe('anthropic adapter', () => {
  test('name 为 claude', () => {
    expect(make(fakeFetch({})).name).toBe('claude')
  })

  test('成功时返回 content[0].text 与 usage（input/output tokens）', async () => {
    const f = fakeFetch({ json: {
      content: [{ type: 'text', text: '你好呀' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    } })
    const r = await make(f).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({
      ok: true, text: '你好呀',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  test('请求打到 /messages，头含 x-api-key 与 anthropic-version', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }] })
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('test-key')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
  })

  test('system 消息进请求顶层 system 字段（不在 messages 里）', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [
      { role: 'system', content: '你是助理' },
      { role: 'user', content: 'hi' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.system).toBe('你是助理')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  test('连续同 role 消息被合并（API 要求 user/assistant 交替）', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [
      { role: 'user', content: '第一句' },
      { role: 'user', content: '第二句' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.messages).toEqual([{ role: 'user', content: '第一句\n第二句' }])
  })

  test('assistant role 保留', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'q2' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'q2' },
    ])
  })

  test('max_tokens 进请求体', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 256 })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.max_tokens).toBe(256)
  })

  test('temperature 可选传入', async () => {
    const f = fakeFetch({ json: { content: [{ text: 'x' }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.3 })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.temperature).toBe(0.3)
  })

  test('500 归类为可重试', async () => {
    const r = await make(fakeFetch({ status: 500 })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('429 归类为可重试', async () => {
    const r = await make(fakeFetch({ status: 429 })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('401 归类为不可重试', async () => {
    const r = await make(fakeFetch({ status: 401 })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(false)
  })

  test('响应缺 content[0].text 判为不可重试', async () => {
    const r = await make(fakeFetch({ json: { content: [] } })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(false)
  })

  test('网络抛错归类为可重试', async () => {
    const r = await make(fakeFetch({ throw: new Error('ECONNRESET') })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('缺 usage 时正常返回', async () => {
    const r = await make(fakeFetch({ json: { content: [{ text: 'hi' }] } })).complete({ messages: [{ role: 'user', content: 'x' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.usage).toBeUndefined()
  })
})
