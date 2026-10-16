import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import type { Logger } from '../utils/logger.js'

export interface AnthropicAdapterOptions {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  log?: Logger
}

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Anthropic Claude 适配器（Messages API）。
 *
 * 与 OpenAI 的差异：
 *   - 鉴权头是 `x-api-key` + `anthropic-version`（不是 Authorization: Bearer）
 *   - `system` 是请求顶层字段（不在 messages 里）
 *   - 只允许 user/assistant 两种 role，连续的 user 需要合并
 *   - 响应取 `content[0].text`；usage 字段名不同（input_tokens/output_tokens）
 */
export function createAnthropicAdapter (opts: AnthropicAdapterOptions): LlmAdapter {
  const { apiKey, model, baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, log } = opts
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    name: 'claude',
    async complete (req: LlmRequest): Promise<LlmResult> {
      const systemMsg = req.messages.find(m => m.role === 'system')

      // 转成 Anthropic 的 messages 形态，合并连续同 role（API 要求 user/assistant 交替）
      const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
      for (const m of req.messages) {
        if (m.role === 'system') continue
        const last = anthropicMessages[anthropicMessages.length - 1]
        if (last && last.role === m.role) {
          last.content += '\n' + m.content
        } else {
          anthropicMessages.push({ role: m.role, content: m.content })
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            messages: anthropicMessages,
            max_tokens: req.maxTokens ?? 1024,
            ...(systemMsg ? { system: systemMsg.content } : {}),
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}`, retryable: res.status >= 500 || res.status === 429 }
        }

        const json = await res.json() as any
        const text = json?.content?.[0]?.text
        if (typeof text !== 'string') {
          return { ok: false, error: '响应缺少 content[0].text', retryable: false }
        }

        const result: LlmResult = { ok: true, text }
        const u = json?.usage
        if (u && typeof u.input_tokens === 'number') {
          result.usage = {
            promptTokens: u.input_tokens,
            completionTokens: u.output_tokens ?? 0,
            totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
          }
        }
        return result
      } catch (e) {
        const msg = (e as Error).name === 'AbortError' ? `请求超时（${timeoutMs}ms）` : (e as Error).message
        log?.warn('claude 调用失败 model=%s: %s', model, msg)
        return { ok: false, error: msg, retryable: true }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
