import { describe, expect, test, vi } from 'vitest'
import { createLlmAdapter, resolveProvider } from '../src/llm/llm-factory.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'

const AI: AppConfig['ai'] = {
  provider: 'deepseek',
  temperature: 0.7,
  maxTokens: 1024,
  memory: { enabled: true, windowSize: 10, ttlMinutes: 30 },
  systemPrompt: 'p',
}

function make (over: Partial<AppConfig['ai']> = {}, env: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'k' }) {
  return createLlmAdapter({ config: { ...AI, ...over }, log: createLogger('FactoryTest'), env })
}

describe('resolveProvider（preset 默认值 + 覆盖）', () => {
  test('deepseek preset 默认值', () => {
    const r = resolveProvider(AI)
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.preset.name).toBe('deepseek')
      expect(r.baseUrl).toBe('https://api.deepseek.com')
      expect(r.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
      expect(r.model).toBe('deepseek-chat')
    }
  })

  test('providerOverrides 覆盖 preset', () => {
    const r = resolveProvider({
      ...AI,
      providerOverrides: { deepseek: { model: 'deepseek-reasoner', baseUrl: 'https://custom.example' } },
    })
    if ('error' in r) throw new Error('unexpected')
    expect(r.model).toBe('deepseek-reasoner')
    expect(r.baseUrl).toBe('https://custom.example')
  })

  test('旧 ark 节仍生效（向后兼容）', () => {
    const r = resolveProvider({
      ...AI,
      provider: 'ark',
      ark: { model: 'doubao-x', baseUrl: 'https://ark.example/api/v3', apiKeyEnv: 'ARK_API_KEY', temperature: 0.7, maxTokens: 1024 },
    })
    if ('error' in r) throw new Error('unexpected')
    expect(r.baseUrl).toBe('https://ark.example/api/v3')
    expect(r.model).toBe('doubao-x')
    expect(r.apiKeyEnv).toBe('ARK_API_KEY')
  })

  test('未知 provider 返回 error', () => {
    const r = resolveProvider({ ...AI, provider: 'no-such-provider' })
    expect('error' in r).toBe(true)
  })
})

describe('createLlmAdapter', () => {
  test('provider=mock 返回 mock（不读 key）', () => {
    expect(make({ provider: 'mock' }, {}).name).toBe('mock')
  })

  test('provider=deepseek（openai-compat）返回 openai 适配器', () => {
    expect(make().name).toBe('openai')
  })

  test('各家 openai-compat 厂商走 openai 适配器（各自的 key 变量名）', () => {
    const cases: Array<[string, string]> = [
      ['qwen', 'DASHSCOPE_API_KEY'],
      ['glm', 'ZHIPU_API_KEY'],
      ['kimi', 'MOONSHOT_API_KEY'],
      ['minimax', 'MINIMAX_API_KEY'],
      ['baichuan', 'BAICHUAN_API_KEY'],
      ['doubao', 'ARK_API_KEY'],
    ]
    for (const [provider, keyEnv] of cases) {
      expect(make({ provider }, { [keyEnv]: 'k' }).name).toBe('openai')
    }
  })

  test('provider=claude 返回 anthropic 适配器', () => {
    expect(make({ provider: 'claude' }, { ANTHROPIC_API_KEY: 'k' }).name).toBe('claude')
  })

  test('provider=gemini 返回 gemini 适配器', () => {
    expect(make({ provider: 'gemini' }, { GEMINI_API_KEY: 'k' }).name).toBe('gemini')
  })

  // 回归：降级 mock 返回「不可用」而非回显占位文本。
  // 若沿用普通 mock，配置事故（忘配 key）会把 `[mock] 收到：…`
  // 这种内部调试标记发进真实微信群。降级必须走上层的兜底话术路径。
  test('key 缺失时降级为「不可用」适配器且不抛错', async () => {
    const adapter = make({}, {})
    expect(adapter.name).toBe('mock-degraded')
    const r = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.retryable).toBe(false)
      expect(r.error).toContain('DEEPSEEK_API_KEY')
    }
  })

  test('key 为空字符串视为缺失', async () => {
    const adapter = make({}, { DEEPSEEK_API_KEY: '' })
    expect(adapter.name).toBe('mock-degraded')
    expect((await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })).ok).toBe(false)
  })

  test('纯空白 key 也视为缺失（避免绕过启动告警）', async () => {
    const adapter = make({}, { DEEPSEEK_API_KEY: '   ' })
    expect(adapter.name).toBe('mock-degraded')
    expect((await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })).ok).toBe(false)
  })

  test('claude 缺 key 时降级（错误信息指向 ANTHROPIC_API_KEY）', async () => {
    const adapter = make({ provider: 'claude' }, {})
    expect(adapter.name).toBe('mock-degraded')
    const r = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ANTHROPIC_API_KEY')
  })

  test('降级时走 log.error 留痕（不静默）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('FactoryWarn')
    const errorSpy = vi.fn()
    ;(log as any).error = errorSpy
    createLlmAdapter({ config: { ...AI }, log, env: {} })
    expect(errorSpy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('env 缺省时读 process.env', () => {
    const prev = process.env['DEEPSEEK_API_KEY']
    process.env['DEEPSEEK_API_KEY'] = 'from-process-env'
    try {
      expect(createLlmAdapter({ config: AI, log: createLogger('T') }).name).toBe('openai')
    } finally {
      if (prev === undefined) delete process.env['DEEPSEEK_API_KEY']
      else process.env['DEEPSEEK_API_KEY'] = prev
    }
  })

  test('LLM_API_KEY_ENV 可自定义 key 存放的环境变量名', () => {
    const cfg = { ...AI, providerOverrides: { deepseek: { apiKeyEnv: 'MY_KEY' } } }
    expect(createLlmAdapter({ config: cfg, log: createLogger('T'), env: { MY_KEY: 'k' } }).name).toBe('openai')
  })

  test('provider=arkcli 返回 arkcli 适配器（不读 key，走本机登录态）', () => {
    const adapter = make({ provider: 'arkcli' }, {})
    expect(adapter.name).toBe('arkcli')
  })

  test('未知 provider 降级且不抛错', () => {
    const adapter = make({ provider: 'no-such' as any }, {})
    expect(adapter.name).toBe('mock-degraded')
  })

  test('provider=mock 时正常回显', async () => {
    const r = await make({ provider: 'mock' }, {}).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('[mock] 收到：hi')
  })
})
