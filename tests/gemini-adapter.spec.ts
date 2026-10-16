import { describe, expect, test, vi } from 'vitest'
import { createGeminiAdapter } from '../src/llm/gemini-adapter.js'

function fakeFetch (opts: { status?: number; json?: any; throw?: Error }) {
  return vi.fn(async () => {
    if (opts.throw) throw opts.throw
    return new Response(JSON.stringify(opts.json ?? {}), { status: opts.status ?? 200 })
  }) as any
}

function make (fetchImpl: any) {
  return createGeminiAdapter({
    apiKey: 'test-key', model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', fetchImpl,
  })
}

describe('gemini adapter', () => {
  test('name 为 gemini', () => {
    expect(make(fakeFetch({})).name).toBe('gemini')
  })

  test('成功时返回 candidates[0].content.parts[0].text 与 usageMetadata', async () => {
    const f = fakeFetch({ json: {
      candidates: [{ content: { parts: [{ text: '你好呀' }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6, totalTokenCount: 14 },
    } })
    const r = await make(f).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({
      ok: true, text: '你好呀',
      usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 },
    })
  })

  test('URL 含 model 与 :generateContent，头含 x-goog-api-key', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }] })
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('test-key')
  })

  test('system 消息进 systemInstruction，且不进 contents', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [
      { role: 'system', content: '你是助理' },
      { role: 'user', content: 'hi' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.systemInstruction).toEqual({ parts: [{ text: '你是助理' }] })
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  test('assistant role 转成 model', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'q2' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
      { role: 'user', parts: [{ text: 'q2' }] },
    ])
  })

  test('连续同 role 消息 parts 合并', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [
      { role: 'user', content: '第一句' },
      { role: 'user', content: '第二句' },
    ] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '第一句' }, { text: '第二句' }] }])
  })

  test('generationConfig 含 maxOutputTokens 与 temperature', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 256, temperature: 0.4 })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 256 })
  })

  test('未传 temperature/maxTokens 时 generationConfig 为空对象', async () => {
    const f = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: 'x' }] } }] } })
    await make(f).complete({ messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(f.mock.calls[0]![1].body)
    expect(body.generationConfig).toEqual({})
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

  test('400 归类为不可重试', async () => {
    const r = await make(fakeFetch({ status: 400 })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(false)
  })

  test('响应缺 candidates[0] 判为不可重试', async () => {
    const r = await make(fakeFetch({ json: { candidates: [] } })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(false)
  })

  test('网络抛错归类为可重试', async () => {
    const r = await make(fakeFetch({ throw: new Error('ECONNRESET') })).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })
})
