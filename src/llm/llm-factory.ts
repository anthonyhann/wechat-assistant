import type { AppConfig } from '../config/config-loader.js'
import type { Logger } from '../utils/logger.js'
import type { LlmAdapter } from './llm-interface.js'
import { createMockAdapter } from './llm-interface.js'
import { createArkAdapter } from './ark-adapter.js'
import { createOpenaiAdapter } from './openai-adapter.js'

export interface LlmFactoryOptions {
  config: AppConfig['ai']
  log: Logger
  /** 缺省读 process.env（便于测试注入） */
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

/**
 * 按 provider 选适配器。
 *
 * **key 缺失时降级为 mock 并 log.error**（用户决策：缺失只告警不崩溃）。
 * 静默降级会让线上「AI 突然变笨」而无法定位，故必须留痕。
 *
 * **降级后的 mock 返回「不可用」而非回显占位文本**（`degraded: true`）：
 * 普通 mock 是开发期主动选择的模式，回显内容便于调试；而 key 缺失是**配置事故**，
 * 此时若把 `[mock] 收到：…` 发进真实微信群，等于把内部调试标记暴露给用户。
 * 故降级 mock 一律返回失败，让上层走「兜底话术 + 转人工提示」的正常降级路径。
 */
export function createLlmAdapter (opts: LlmFactoryOptions): LlmAdapter {
  const { config, log } = opts
  const env = opts.env ?? process.env

  if (config.provider === 'mock') {
    return createMockAdapter()
  }

  /** key 缺失时的降级 mock：返回失败而非回显，避免调试文本进真实会话 */
  const degradedMock = (provider: string, keyEnv: string): LlmAdapter => {
    log.error('provider=%s 但环境变量 %s 未设置，已降级（AI 功能不可用，将回复兜底话术）', provider, keyEnv)
    return {
      name: 'mock-degraded',
      async complete () {
        return { ok: false, error: `LLM 未配置（${keyEnv} 缺失）`, retryable: false }
      },
    }
  }

  if (config.provider === 'ark') {
    const apiKey = env[config.ark.apiKeyEnv]
    if (!apiKey) return degradedMock('ark', config.ark.apiKeyEnv)
    return createArkAdapter({
      apiKey, model: config.ark.model, baseUrl: config.ark.baseUrl,
      fetchImpl: opts.fetchImpl,
      // Task2 补的可选 log：失败时只记 model + 错误摘要，不记 key 与响应体
      log,
    })
  }

  // provider === 'openai'
  const apiKey = env[config.openaiCompat.apiKeyEnv]
  if (!apiKey) return degradedMock('openai', config.openaiCompat.apiKeyEnv)
  return createOpenaiAdapter({
    apiKey, model: config.openaiCompat.model, baseUrl: config.openaiCompat.baseUrl,
    fetchImpl: opts.fetchImpl,
    log,
  })
}
