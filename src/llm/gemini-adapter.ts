import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import type { Logger } from '../utils/logger.js'

export interface GeminiAdapterOptions {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  log?: Logger
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Google Gemini 适配器（generateContent API）。
 *
 * 与 OpenAI 的差异：
 *   - 鉴权头是 `x-goog-api-key`（key 也可以放 URL query，但头更安全）
 *   - role 叫 `model` 而非 `assistant`，且 `system` 用 systemInstruction 字段
 *   - 响应取 `candidates[0].content.parts[0].text`
 *   - usage 字段名是 promptTokenCount / candidatesTokenCount
 */
export function createGeminiAdapter (opts: GeminiAdapterOptions): LlmAdapter {
  const { apiKey, model, baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, log } = opts
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    name: 'gemini',
    async complete (req: LlmRequest): Promise<LlmResult> {
      const systemMsg = req.messages.find(m => m.role === 'system')

      // 转成 Gemini 的 contents 形态，合并连续同 role
      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
      for (const m of req.messages) {
        if (m.role === 'system') continue
        const role = m.role === 'assistant' ? 'model' : 'user'
        const last = contents[contents.length - 1]
        if (last && last.role === role) {
          last.parts.push({ text: m.content })
        } else {
          contents.push({ role, parts: [{ text: m.content }] })
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetchImpl(
          `${baseUrl.replace(/\/$/, '')}/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents,
              ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
              generationConfig: {
                ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
                ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
              },
            }),
            signal: controller.signal,
          },
        )

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}`, retryable: res.status >= 500 || res.status === 429 }
        }

        const json = await res.json() as any
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
        if (typeof text !== 'string') {
          return { ok: false, error: '响应缺少 candidates[0].content.parts[0].text', retryable: false }
        }

        const result: LlmResult = { ok: true, text }
        const u = json?.usageMetadata
        if (u && typeof u.promptTokenCount === 'number') {
          result.usage = {
            promptTokens: u.promptTokenCount,
            completionTokens: u.candidatesTokenCount ?? 0,
            totalTokens: u.totalTokenCount ?? (u.promptTokenCount + (u.candidatesTokenCount ?? 0)),
          }
        }
        return result
      } catch (e) {
        const msg = (e as Error).name === 'AbortError' ? `请求超时（${timeoutMs}ms）` : (e as Error).message
        log?.warn('gemini 调用失败 model=%s: %s', model, msg)
        return { ok: false, error: msg, retryable: true }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
