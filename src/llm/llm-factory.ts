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
 */
export function createLlmAdapter (opts: LlmFactoryOptions): LlmAdapter {
  const { config, log } = opts
  const env = opts.env ?? process.env

  if (config.provider === 'mock') {
    return createMockAdapter()
  }

  if (config.provider === 'ark') {
    const apiKey = env[config.ark.apiKeyEnv]
    if (!apiKey) {
      log.error('provider=ark 但环境变量 %s 未设置，已降级为 mock adapter', config.ark.apiKeyEnv)
      return createMockAdapter()
    }
    return createArkAdapter({
      apiKey, model: config.ark.model, baseUrl: config.ark.baseUrl,
      fetchImpl: opts.fetchImpl,
      // Task2 补的可选 log：失败时只记 model + 错误摘要，不记 key 与响应体
      log,
    })
  }

  // provider === 'openai'
  const apiKey = env[config.openaiCompat.apiKeyEnv]
  if (!apiKey) {
    log.error('provider=openai 但环境变量 %s 未设置，已降级为 mock adapter', config.openaiCompat.apiKeyEnv)
    return createMockAdapter()
  }
  return createOpenaiAdapter({
    apiKey, model: config.openaiCompat.model, baseUrl: config.openaiCompat.baseUrl,
    fetchImpl: opts.fetchImpl,
    log,
  })
}
