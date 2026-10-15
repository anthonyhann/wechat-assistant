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
  | { ok: true; text: string }
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
      return { ok: true, text: `[mock] 收到：${content}` }
    },
  }
}
