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

  test('key 缺失时降级 mock 且不抛错', () => {
    expect(make({}, {}).name).toBe('mock')
  })

  test('key 为空字符串视为缺失', () => {
    expect(make({}, { ARK_API_KEY: '' }).name).toBe('mock')
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

  test('mock adapter 可正常完成请求', async () => {
    const r = await make({ provider: 'mock' }, {}).complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.ok).toBe(true)
  })
})
