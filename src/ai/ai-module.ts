import type { LlmAdapter } from '../llm/llm-interface.js'
import type { MemoryWindow } from './memory.js'
import type { SafeSender } from '../safety/safe-sender.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import type { UsageRepository } from '../storage/db.js'

export type AiChatResult = { replied: boolean; reason: string }

export interface AiModule {
  /**
   * @param sender 本条消息的发送通道（由 router 创建）。
   *   不作为构造参数，因为它绑定具体的 msg，生命周期是「一条消息」。
   */
  chat (conversationId: string, userText: string, sender: SafeSender): Promise<AiChatResult>
}

export interface AiModuleDeps {
  llm: LlmAdapter
  memory: MemoryWindow
  log: Logger
  config: AppConfig['ai']
  fallbackReply: string
  /** 可选：LLM 用量落库。缺省时用 no-op，既不影响调用方，也让旧测试无需改造 */
  usageRepo?: UsageRepository
}

/** LLM 不可用时的第二句话：告诉用户可以转人工 */
const HANDOFF_HINT = '如持续无法回答，可回复「人工」转接客服。'

const NOOP_USAGE_REPO: Pick<UsageRepository, 'insert'> = { insert: () => {} }

/**
 * AI 对话模块（阶段 3）。
 *
 * 职责：prompt 组装 → 调 LLM → 经 SafeSender 回复 → 维护记忆。
 * **不直接发消息、不自行调用安全闸门** —— 出口统一走 sender（阶段 2 收口）。
 */
export function createAiModule (deps: AiModuleDeps): AiModule {
  const { llm, memory, log, config, fallbackReply } = deps
  const usageRepo = deps.usageRepo ?? NOOP_USAGE_REPO

  return {
    async chat (conversationId, userText, sender): Promise<AiChatResult> {
      // 1. 组装 prompt：system + 窗口历史 + 本轮 user
      const history = memory.get(conversationId)
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: config.systemPrompt },
        ...history.map(t => ({ role: t.role, content: t.content })),
        { role: 'user', content: userText },
      ]

      // 2. 调 LLM（LlmResult 不抛错；空回复视为失败，避免发空白消息）
      const result = await llm.complete({
        messages,
        temperature: config.ark.temperature,
        maxTokens: config.ark.maxTokens,
      })

      // 落 usage（无论成败都记录）
      try {
        usageRepo.insert({
          conversation_id: conversationId,
          provider: config.provider,
          model: config.ark.model,
          prompt_tokens: result.ok && result.usage ? result.usage.promptTokens : null,
          completion_tokens: result.ok && result.usage ? result.usage.completionTokens : null,
          total_tokens: result.ok && result.usage ? result.usage.totalTokens : null,
          ok: result.ok ? 1 : 0,
          error: result.ok ? null : result.error,
          created_at: Date.now(),
        })
      } catch (e) {
        log.error('usage 落库失败 conv=%s: %s', conversationId, (e as Error).message)
      }

      if (!result.ok || !result.text.trim()) {
        const err = result.ok ? 'LLM 返回空内容' : result.error
        log.error('LLM 调用失败 conv=%s: %s', conversationId, err)

        // 失败路径：兜底话术 + 转人工提示；只记 user 轮
        memory.append(conversationId, { role: 'user', content: userText, at: Date.now() })
        await sender.send(`${fallbackReply}${HANDOFF_HINT}`)
        return { replied: true, reason: 'llm_failed' }
      }

      // 3. 成功路径：回复 + 记忆写两轮
      const sent = await sender.send(result.text)
      const now = Date.now()
      memory.append(conversationId, { role: 'user', content: userText, at: now })
      memory.append(conversationId, { role: 'assistant', content: result.text, at: now })
      // 区分「用户看到了 AI 回复」与「回复被安全闸门拦下换成了兜底话术」——
      // 否则阶段 4 的 AI 成功率统计会被拦截事件虚增。
      return { replied: true, reason: sent ? 'ok' : 'blocked' }
    },
  }
}
