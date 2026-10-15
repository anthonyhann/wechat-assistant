import { describe, expect, test, vi } from 'vitest'
import { createArkAdapter } from '../src/llm/ark-adapter.js'
import { createOpenaiAdapter } from '../src/llm/openai-adapter.js'

/** 构造 OpenAI 兼容的成功响应 */
function okResponse (text: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: text } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function makeArk (fetchImpl: any) {
  return createArkAdapter({ apiKey: 'test-key', model: 'm', baseUrl: 'https://ark.example/api/v3', fetchImpl })
}

describe('Ark adapter', () => {
  test('成功时返回文本', async () => {
    const fake = vi.fn(async () => okResponse('你好呀'))
    const r = await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({ ok: true, text: '你好呀' })
  })

  test('请求打到 /chat/completions 且带 Authorization 头', async () => {
    const fake = vi.fn(async () => okResponse('x'))
    await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    const [url, init] = fake.mock.calls[0]!
    expect(String(url)).toBe('https://ark.example/api/v3/chat/completions')
    expect((init as any).headers.Authorization).toBe('Bearer test-key')
  })

  test('请求体含 model / messages / temperature / max_tokens', async () => {
    const fake = vi.fn(async () => okResponse('x'))
    await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, maxTokens: 256 })
    const body = JSON.parse((fake.mock.calls[0]![1] as any).body)
    expect(body.model).toBe('m')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(256)
  })

  test('缺 temperature/maxTokens 时不放进请求体', async () => {
    const fake = vi.fn(async () => okResponse('x'))
    await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse((fake.mock.calls[0]![1] as any).body)
    expect('temperature' in body).toBe(false)
    expect('max_tokens' in body).toBe(false)
  })

  test('401 归类为不可重试，且报错不含 key', async () => {
    const fake = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const r = await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.retryable).toBe(false)
      expect(r.error).not.toContain('test-key')
    }
  })

  test('500 归类为可重试', async () => {
    const fake = vi.fn(async () => new Response('boom', { status: 500 }))
    const r = await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('网络抛错归类为可重试', async () => {
    const fake = vi.fn(async () => { throw new Error('ECONNRESET') })
    const r = await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('响应缺 choices 时判为不可重试', async () => {
    const fake = vi.fn(async () => okResponse('x').json ? new Response(JSON.stringify({}), { status: 200 }) : okResponse('x'))
    const r = await makeArk(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(false)
  })

  test('name 为 ark', () => {
    expect(makeArk(vi.fn()).name).toBe('ark')
  })
})

describe('OpenAI adapter', () => {
  function make (fetchImpl: any) {
    return createOpenaiAdapter({ apiKey: 'k', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', fetchImpl })
  }

  test('成功返回文本', async () => {
    const r = await make(vi.fn(async () => okResponse('hello'))).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({ ok: true, text: 'hello' })
  })

  test('URL 与 model 正确', async () => {
    const fake = vi.fn(async () => okResponse('x'))
    await make(fake).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(String(fake.mock.calls[0]![0])).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse((fake.mock.calls[0]![1] as any).body).model).toBe('gpt-4o-mini')
  })

  // 安全：log 选项存在但绝不记录 apiKey / 响应体
  test('注入 log 时不泄露 apiKey 与响应体', async () => {
    const lines: string[] = []
    const fakeLog: any = new Proxy({}, {
      get: (_t, prop: string) => (...args: any[]) => { lines.push(`${prop}: ${args.join(' ')}`) },
    })
    const r = await makeArk(vi.fn(async () => new Response('{"leak":"SECRET-KEY-12345"}', { status: 401 })))
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)

    // 用带 log 的适配器再跑一次，检查所有日志行
    const withLog = createArkAdapter({
      apiKey: 'SECRET-KEY-12345', model: 'm', baseUrl: 'https://x.com',
      fetchImpl: (async () => new Response('{"leak":"SECRET-KEY-12345"}', { status: 401 })) as any,
      log: fakeLog,
    })
    await withLog.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain('SECRET-KEY-12345')
      expect(line).not.toContain('leak')
    }
  })

  test('name 为 openai', () => {
    expect(make(vi.fn()).name).toBe('openai')
  })

  test('429 限流归类为可重试', async () => {
    const r = await make(vi.fn(async () => new Response('rate limited', { status: 429 }))).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })
})
