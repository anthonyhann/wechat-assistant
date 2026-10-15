import { describe, expect, test, vi } from 'vitest'
import { createLlmAdapter } from '../src/llm/llm-factory.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'

const AI: AppConfig['ai'] = {
  provider: 'ark',
  ark: { model: 'doubao-x', baseUrl: 'https://ark.example/api/v3', apiKeyEnv: 'ARK_API_KEY', temperature: 0.7, maxTokens: 1024 },
  openaiCompat: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  memory: { enabled: true, windowSize: 10, ttlMinutes: 30 },
  systemPrompt: 'p',
}

function make (over: Partial<AppConfig['ai']> = {}, env: Record<string, string | undefined> = { ARK_API_KEY: 'k' }) {
  return createLlmAdapter({ config: { ...AI, ...over }, log: createLogger('FactoryTest'), env })
}

describe('createLlmAdapter', () => {
  test('provider=mock 返回 mock（不读 key）', () => {
    expect(make({ provider: 'mock' }, {}).name).toBe('mock')
  })

  test('provider=ark 且 key 存在返回 ark', () => {
    expect(make().name).toBe('ark')
  })

  test('provider=openai 且 key 存在返回 openai', () => {
    expect(make({ provider: 'openai' }, { OPENAI_API_KEY: 'k' }).name).toBe('openai')
  })

  // 回归：降级 mock 返回「不可用」而非回显占位文本。
  // 若沿用普通 mock，配置事故（provider=ark 忘配 key）会把 `[mock] 收到：…`
  // 这种内部调试标记发进真实微信群。降级必须走上层的兜底话术路径。
  test('key 缺失时降级为「不可用」适配器且不抛错', async () => {
    const adapter = make({}, {})
    expect(adapter.name).toBe('mock-degraded')
    const r = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.retryable).toBe(false)
      expect(r.error).toContain('ARK_API_KEY')
    }
  })

  test('key 为空字符串视为缺失', async () => {
    const adapter = make({}, { ARK_API_KEY: '' })
    expect(adapter.name).toBe('mock-degraded')
    expect((await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })).ok).toBe(false)
  })

  test('降级时走 log.error 留痕（不静默）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('FactoryWarn')
    const warnSpy = vi.fn()
    ;(log as any).error = warnSpy
    createLlmAdapter({ config: { ...AI }, log, env: {} })
    expect(warnSpy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('env 缺省时读 process.env', () => {
    const prev = process.env['ARK_API_KEY']
    process.env['ARK_API_KEY'] = 'from-process-env'
    try {
      expect(createLlmAdapter({ config: AI, log: createLogger('T') }).name).toBe('ark')
    } finally {
      if (prev === undefined) delete process.env['ARK_API_KEY']
      else process.env['ARK_API_KEY'] = prev
    }
  })

  test('apiKeyEnv 指向的变量名可自定义', () => {
    const cfg = { ...AI, ark: { ...AI.ark, apiKeyEnv: 'MY_ARK_KEY' } }
    expect(createLlmAdapter({ config: cfg, log: createLogger('T'), env: { MY_ARK_KEY: 'k' } }).name).toBe('ark')
  })

  // 主动选择 provider=mock（开发模式）才回显；与 key 缺失的被动降级区分开
  test('provider=mock 时正常回显', async () => {
    const r = await make({ provider: 'mock' }, {}).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('[mock] 收到：hi')
  })
})
