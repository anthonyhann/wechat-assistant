import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import { postJson } from './llm-interface.js'
import type { Logger } from '../utils/logger.js'

export interface OpenaiAdapterOptions {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** 可选日志：只记录结果摘要（**绝不记录 apiKey 与响应体**） */
  log?: Logger
}

/** OpenAI 兼容适配器 */
export function createOpenaiAdapter (opts: OpenaiAdapterOptions): LlmAdapter {
  return {
    name: 'openai',
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
        opts.log?.warn('openai 调用失败 model=%s: %s', opts.model, res.error)
        return { ok: false, error: res.error, retryable: res.retryable }
      }

      const text = res.json?.choices?.[0]?.message?.content
      if (typeof text !== 'string') {
        opts.log?.warn('openai 响应畸形 model=%s', opts.model)
        return { ok: false, error: '响应缺少 choices[0].message.content', retryable: false }
      }
      const usage = res.json?.usage
      const result: LlmResult = { ok: true, text }
      if (usage && typeof usage.total_tokens === 'number') {
        result.usage = {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens,
        }
      }
      return result
    },
  }
}
