import { describe, expect, test, vi } from 'vitest'
import { createArkcliAdapter } from '../src/llm/arkcli-adapter.js'
import type { LlmMessage } from '../src/llm/llm-interface.js'

/** 构造一个立即回调的假 execFile，返回给定的 stdout/stderr/error */
function fakeExec (opts: { stdout?: string; stderr?: string; error?: Error | null }) {
  return vi.fn(((_cmd: string, _args: string[], _o: any, cb: any) => {
    cb(opts.error ?? null, opts.stdout ?? '', opts.stderr ?? '')
    return {} as any
  }) as any) as any
}

const okJson = JSON.stringify({
  status: 'completed',
  content: '你好呀！我是你的微信群个人助理～',
  usage: { prompt_tokens: 18, completion_tokens: 30, total_tokens: 48 },
})

function makeReq (messages: LlmMessage[], over: Partial<any> = {}) {
  return { messages, ...over }
}

describe('arkcli adapter', () => {
  test('name 为 arkcli', () => {
    expect(createArkcliAdapter({ model: 'm', execFileImpl: fakeExec({}) }).name).toBe('arkcli')
  })

  test('成功时返回 content 与 usage', async () => {
    const a = createArkcliAdapter({ model: 'deepseek-v4.1-flash', execFileImpl: fakeExec({ stdout: okJson }) })
    const r = await a.complete(makeReq([
      { role: 'system', content: '你是助理' },
      { role: 'user', content: '你好' },
    ]))
    expect(r).toEqual({
      ok: true,
      text: '你好呀！我是你的微信群个人助理～',
      usage: { promptTokens: 18, completionTokens: 30, totalTokens: 48 },
    })
  })

  test('命令行含 model / instructions / 用户输入 / thinking disabled', async () => {
    const exec = fakeExec({ stdout: okJson })
    const a = createArkcliAdapter({ model: 'deepseek-v4.1-flash', execFileImpl: exec })
    await a.complete(makeReq([
      { role: 'system', content: '你是微信群个人助理' },
      { role: 'user', content: '今天天气' },
    ], { temperature: 0.5, maxTokens: 256 }))
    const args = exec.mock.calls[0]![1] as string[]
    expect(args[0]).toBe('+chat')
    expect(args).toContain('deepseek-v4.1-flash')
    expect(args).toContain('--instructions')
    expect(args[args.indexOf('--instructions') + 1]).toBe('你是微信群个人助理')
    expect(args).toContain('--temperature')
    expect(args[args.indexOf('--temperature') + 1]).toBe('0.5')
    expect(args).toContain('--max-output-tokens')
    expect(args[args.indexOf('--max-output-tokens') + 1]).toBe('256')
    expect(args).toContain('--thinking')
    expect(args).toContain('disabled')
    expect(args[args.length - 1]).toBe('今天天气')
  })

  // arkcli +chat 是单轮 CLI，历史必须序列化进 prompt（唯一可行的多轮方式）
  test('对话历史被序列化进 prompt（多轮记忆可用）', async () => {
    const exec = fakeExec({ stdout: okJson })
    const a = createArkcliAdapter({ model: 'm', execFileImpl: exec })
    await a.complete(makeReq([
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '第二句' },
    ]))
    const prompt = (exec.mock.calls[0]![1] as string[]).at(-1)!
    expect(prompt).toContain('用户：第一句')
    expect(prompt).toContain('助理：回复')
    expect(prompt).toContain('第二句')
    // 本轮（最后一条 user）不带前缀，在末尾
    expect(prompt.endsWith('第二句')).toBe(true)
  })

  test('无历史时 prompt 就是纯用户输入（不加包装）', async () => {
    const exec = fakeExec({ stdout: okJson })
    const a = createArkcliAdapter({ model: 'm', execFileImpl: exec })
    await a.complete(makeReq([{ role: 'user', content: '今天天气' }]))
    const prompt = (exec.mock.calls[0]![1] as string[]).at(-1)!
    expect(prompt).toBe('今天天气')
  })

  test('无 system 消息时不传 --instructions', async () => {
    const exec = fakeExec({ stdout: okJson })
    const a = createArkcliAdapter({ model: 'm', execFileImpl: exec })
    await a.complete(makeReq([{ role: 'user', content: 'hi' }]))
    const args = exec.mock.calls[0]![1] as string[]
    expect(args).not.toContain('--instructions')
  })

  test('环境变量带 ARKCLI_NO_UPDATE_NOTIFIER（保证 stdout 纯净）', async () => {
    const exec = fakeExec({ stdout: okJson })
    const a = createArkcliAdapter({ model: 'm', execFileImpl: exec })
    await a.complete(makeReq([{ role: 'user', content: 'hi' }]))
    const env = exec.mock.calls[0]![2].env as Record<string, string>
    expect(env.ARKCLI_NO_UPDATE_NOTIFIER).toBe('1')
    expect(env.ARKCLI_CALLER_TYPE).toBe('ai_agent')
    expect(env.ARKCLI_SKILL_NAME).toBe('arkcli-chat')
  })

  test('status != completed 时判为可重试失败', async () => {
    const a = createArkcliAdapter({
      model: 'm',
      execFileImpl: fakeExec({ stdout: JSON.stringify({ status: 'incomplete', content: 'x' }) }),
    })
    const r = await a.complete(makeReq([{ role: 'user', content: 'hi' }]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('exec 出错（未登录/超时）时判为可重试失败', async () => {
    const a = createArkcliAdapter({
      model: 'm',
      execFileImpl: fakeExec({ error: new Error('command failed') }),
    })
    const r = await a.complete(makeReq([{ role: 'user', content: 'hi' }]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryable).toBe(true)
  })

  test('stdout 非 JSON 时判为不可重试失败（CLI 用法错）', async () => {
    const a = createArkcliAdapter({
      model: 'm',
      execFileImpl: fakeExec({ stdout: 'Error: unknown flag', stderr: 'unknown flag' }),
    })
    const r = await a.complete(makeReq([{ role: 'user', content: 'hi' }]))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.retryable).toBe(false)
      expect(r.error).toContain('非 JSON')
    }
  })

  test('响应缺 usage 时正常返回（usage 可选）', async () => {
    const a = createArkcliAdapter({
      model: 'm',
      execFileImpl: fakeExec({ stdout: JSON.stringify({ status: 'completed', content: 'hi' }) }),
    })
    const r = await a.complete(makeReq([{ role: 'user', content: 'x' }]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.usage).toBeUndefined()
  })
})
