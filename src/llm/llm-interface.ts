export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
  role: LlmRole
  content: string
}

export interface LlmRequest {
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
  model?: string
}

/**
 * LLM 调用结果。
 *
 * 用判别联合而非抛错：限流/超时是常态业务路径，抛错会逼每个调用方写 try/catch，
 * 且容易把「LLM 不可用」误当成「程序 bug」而在监控上告警错东西。
 *
 * retryable：true 表示值得重试（超时 / 5xx / 限流），false 表示重试也没用
 * （参数错 / 鉴权失败 / 内容违规）。
 */
export type LlmResult =
  | { ok: true; text: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { ok: false; error: string; retryable: boolean }

export interface LlmAdapter {
  readonly name: string
  complete (req: LlmRequest): Promise<LlmResult>
}

/** 取最后一条 user 消息内容；没有则返回 null（异常用法） */
export function lastUserContent (messages: LlmMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return messages[i]!.content
  }
  return null
}

/**
 * mock 适配器：不打网络、零费用、结果确定。
 * 开发与测试期默认使用；上线前切换 ai.json 的 provider 即可。
 */
export function createMockAdapter (): LlmAdapter {
  return {
    name: 'mock',
    async complete (req: LlmRequest): Promise<LlmResult> {
      const content = lastUserContent(req.messages)
      if (content === null) {
        return { ok: false, error: 'mock adapter: messages 中没有 user 消息', retryable: false }
      }
      return { ok: true, text: `[mock] 收到：${content}`, usage: { promptTokens: content.length, completionTokens: 20, totalTokens: content.length + 20 } }
    },
  }
}

export interface PostJsonOptions {
  url: string
  apiKey: string
  body: Record<string, unknown>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type PostJsonResult =
  | { ok: true; json: any }
  | { ok: false; error: string; retryable: boolean }

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * POST JSON 到 OpenAI 兼容端点，统一处理超时 / 网络错 / 状态码分类。
 *
 * 报错信息**不含 apiKey** —— 401 时若把响应体或请求头回显进 error，
 * key 会随日志外泄。
 */
export async function postJson (opts: PostJsonOptions): Promise<PostJsonResult> {
  const { url, apiKey, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      // 只报状态码，不回显响应体（可能含敏感信息）与 key
      return { ok: false, error: `HTTP ${res.status}`, retryable: res.status >= 500 || res.status === 429 }
    }

    let json: any
    try {
      json = await res.json()
    } catch {
      return { ok: false, error: '响应不是合法 JSON', retryable: false }
    }
    return { ok: true, json }
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? `请求超时（${timeoutMs}ms）` : (e as Error).message
    return { ok: false, error: msg, retryable: true }
  } finally {
    clearTimeout(timer)
  }
}
