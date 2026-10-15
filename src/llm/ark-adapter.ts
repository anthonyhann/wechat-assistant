import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import { postJson } from './llm-interface.js'
import type { Logger } from '../utils/logger.js'

export interface ArkAdapterOptions {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** 可选日志：只记录结果摘要（**绝不记录 apiKey 与响应体**） */
  log?: Logger
}

/** 火山方舟（ARK）适配器 —— OpenAI 兼容协议 */
export function createArkAdapter (opts: ArkAdapterOptions): LlmAdapter {
  return {
    name: 'ark',
    async complete (req: LlmRequest): Promise<LlmResult> {
      const res = await postJson({
        url: `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`,
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs,
        fetchImpl: opts.fetchImpl,
        body: {
          model: opts.model,
          messages: req.messages,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        },
      })

      if (!res.ok) {
        opts.log?.warn('ark 调用失败 model=%s: %s', opts.model, res.error)
        return { ok: false, error: res.error, retryable: res.retryable }
      }

      const text = res.json?.choices?.[0]?.message?.content
      if (typeof text !== 'string') {
        opts.log?.warn('ark 响应畸形 model=%s', opts.model)
        return { ok: false, error: '响应缺少 choices[0].message.content', retryable: false }
      }
      return { ok: true, text }
    },
  }
}
