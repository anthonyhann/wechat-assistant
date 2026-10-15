import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import { postJson } from './llm-interface.js'

export interface ArkAdapterOptions {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
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

      if (!res.ok) return { ok: false, error: res.error, retryable: res.retryable }

      const text = res.json?.choices?.[0]?.message?.content
      if (typeof text !== 'string') {
        return { ok: false, error: '响应缺少 choices[0].message.content', retryable: false }
      }
      return { ok: true, text }
    },
  }
}
