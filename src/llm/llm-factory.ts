import type { AppConfig } from '../config/config-loader.js'
import type { Logger } from '../utils/logger.js'
import type { LlmAdapter } from './llm-interface.js'
import { createMockAdapter } from './llm-interface.js'
import { createArkAdapter } from './ark-adapter.js'
import { createArkcliAdapter } from './arkcli-adapter.js'
import { createOpenaiAdapter } from './openai-adapter.js'
import { createAnthropicAdapter } from './anthropic-adapter.js'
import { createGeminiAdapter } from './gemini-adapter.js'
import { findPreset, PROVIDER_NAMES, type ProviderPreset } from './providers.js'

export interface LlmFactoryOptions {
  config: AppConfig['ai']
  log: Logger
  /** 缺省读 process.env（便于测试注入） */
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

/**
 * 解析某个 provider 的生效配置：preset 默认值 ← ai.json 覆盖 ← 环境变量覆盖。
 *
 * 优先级（低→高）：preset 默认 < ai.json 的 providerOverrides < .env。
 * 返回 { preset, baseUrl, apiKeyEnv, model }，调用方据此选适配器。
 */
export interface ResolvedProvider {
  preset: ProviderPreset
  baseUrl: string
  apiKeyEnv: string
  model: string
}

export function resolveProvider (config: AppConfig['ai']): ResolvedProvider | { error: string } {
  const preset = findPreset(config.provider)
  if (!preset) {
    return { error: `未知 LLM provider: ${config.provider}（已知: ${PROVIDER_NAMES.join(', ')}）` }
  }

  // 兼容旧配置：ark / openaiCompat 节的覆盖仍生效
  const legacy = config.provider === 'ark'
    ? config.ark
    : config.provider === 'openai'
      ? config.openaiCompat
      : undefined

  const overrides = config.providerOverrides?.[config.provider] ?? {}

  const baseUrl = overrides.baseUrl
    ?? (legacy as any)?.baseUrl
    ?? preset.baseUrl
  const apiKeyEnv = overrides.apiKeyEnv
    ?? (legacy as any)?.apiKeyEnv
    ?? preset.apiKeyEnv
  const model = overrides.model
    ?? (legacy as any)?.model
    ?? preset.models[0]
    ?? ''

  return { preset, baseUrl, apiKeyEnv, model }
}

/**
 * 按 provider 选适配器。
 *
 * **key 缺失时降级为 mock 并 log.error**（用户决策：缺失只告警不崩溃）。
 * 静默降级会让线上「AI 突然变笨」而无法定位，故必须留痕。
 *
 * 降级 mock 返回「不可用」而非回显占位文本：key 缺失是**配置事故**，
 * 把 `[mock] 收到：…` 发进真实微信群等于暴露内部调试标记。
 */
export function createLlmAdapter (opts: LlmFactoryOptions): LlmAdapter {
  const { config, log } = opts
  const env = opts.env ?? process.env

  if (config.provider === 'mock') {
    return createMockAdapter()
  }

  const resolved = resolveProvider(config)
  if ('error' in resolved) {
    log.error('%s', resolved.error)
    return degradedMock(config.provider, '(未知 provider)')
  }

  const { preset, baseUrl, apiKeyEnv, model } = resolved

  // arkcli：走本机 CLI，不需要 API key
  if (preset.protocol === 'arkcli') {
    return createArkcliAdapter({ model, log })
  }

  // 其余协议都需要 API key
  const apiKey = env[apiKeyEnv]
  if (!apiKey?.trim()) {
    log.error('provider=%s 但环境变量 %s 未设置，已降级（AI 功能不可用，将回复兜底话术）', config.provider, apiKeyEnv)
    return degradedMock(config.provider, apiKeyEnv)
  }

  switch (preset.protocol) {
    case 'openai-compat':
      return createOpenaiAdapter({
        apiKey, model, baseUrl, fetchImpl: opts.fetchImpl, log,
      })
    case 'anthropic':
      return createAnthropicAdapter({
        apiKey, model, baseUrl, fetchImpl: opts.fetchImpl, log,
      })
    case 'gemini':
      return createGeminiAdapter({
        apiKey, model, baseUrl, fetchImpl: opts.fetchImpl, log,
      })
    default:
      // mock 已在函数开头处理；这里是编译期穷尽性保险
      log.error('provider=%s 的协议 %s 无适配器', config.provider, preset.protocol)
      return degradedMock(config.provider, apiKeyEnv)
  }
}

/** key 缺失/未知 provider 时的降级：返回失败而非回显，避免调试文本进真实会话 */
function degradedMock (provider: string, keyEnv: string): LlmAdapter {
  return {
    name: 'mock-degraded',
    async complete () {
      return { ok: false, error: `LLM 未配置（${keyEnv} 缺失）`, retryable: false }
    },
  }
}
