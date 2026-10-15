import type { LlmAdapter } from '../llm/llm-interface.js'
import type { MemoryWindow } from './memory.js'
import type { SafeSender } from '../safety/safe-sender.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import type { UsageRepository } from '../storage/db.js'

/** reason 值域：'ok' | 'blocked' | 'llm_failed' | 'throttled'（throttled 时 replied=false，调用方不写 handled_by='ai'） */
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
 *
 * 阶段 4 增量：
 * - 节流：同一 conversationId 在 throttleSeconds 内最多 1 次（0=不节流），
 *   被节流返回 `{replied:false, reason:'throttled'}`，不调 LLM；
 * - prompt 硬顶：单条用户消息截断 maxPromptChars；历史窗口总字符超限
 *   时从最新往回保留、淘汰最旧轮次；
 * - memory.enabled=false 时不读历史也不写记忆。
 */
export function createAiModule (deps: AiModuleDeps): AiModule {
  const { llm, memory, log, config, fallbackReply } = deps
  const usageRepo = deps.usageRepo ?? NOOP_USAGE_REPO
  /** key = conversationId → 上次 AI 调用时间戳 */
  const lastCallAt = new Map<string, number>()

  return {
    async chat (conversationId, userText, sender): Promise<AiChatResult> {
      // 节流：窗口内第二次调用直接跳过（不调 LLM、不回复）
      const throttleMs = (config.throttleSeconds ?? 10) * 1000
      if (throttleMs > 0) {
        const last = lastCallAt.get(conversationId)
        if (last !== undefined && Date.now() - last < throttleMs) {
          log.verbose('AI 节流中 conv=%s', conversationId)
          return { replied: false, reason: 'throttled' }
        }
        lastCallAt.set(conversationId, Date.now())
      }

      // 截断用户输入（单条硬顶）
      const maxChars = config.maxPromptChars ?? 8000
      const trimmedText = userText.length > maxChars ? userText.slice(0, maxChars) : userText

      // 1. 组装 prompt：system + 窗口历史 + 本轮 user
      const history = config.memory.enabled ? memory.get(conversationId) : []
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: config.systemPrompt },
        ...history.map(t => ({ role: t.role, content: t.content })),
        { role: 'user', content: trimmedText },
      ]

      // 历史窗口总字符上限（从最新的开始往回保留，直到超限）
      if (messages.length > 2) {
        const historyBudget = maxChars - config.systemPrompt.length - trimmedText.length
        if (historyBudget > 0) {
          let used = 0
          const kept: typeof messages = [messages[0]!]
          for (let i = messages.length - 2; i >= 1; i--) {
            const m = messages[i]!
            if (used + m.content.length > historyBudget) break
            used += m.content.length
            kept.push(m)
          }
          // kept 现在是 [system, ...倒序历史]，倒回来 + 本轮 user
          messages.length = 0
          messages.push(kept[0]!, ...kept.slice(1).reverse(), { role: 'user' as const, content: trimmedText })
        } else {
          // 本轮消息已占满预算 → 丢弃全部历史，只留 system + 本轮。
          // 否则「历史原样全进」会让硬顶名存实亡（长文 + 长历史 → 80k+ 字符）。
          log.warn('本轮消息已占满 prompt 预算，丢弃全部历史 conv=%s', conversationId)
          messages.length = 0
          messages.push(
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: trimmedText },
          )
        }
      }

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

        // 失败路径：兜底话术 + 转人工提示；只记 user 轮（memory.enabled=false 时不写）
        if (config.memory.enabled) {
          memory.append(conversationId, { role: 'user', content: trimmedText, at: Date.now() })
        }
        await sender.send(`${fallbackReply}${HANDOFF_HINT}`)
        return { replied: true, reason: 'llm_failed' }
      }

      // 3. 成功路径：回复 + 记忆写两轮（memory.enabled=false 时不写）
      const sent = await sender.send(result.text)
      const now = Date.now()
      if (config.memory.enabled) {
        memory.append(conversationId, { role: 'user', content: trimmedText, at: now })
        memory.append(conversationId, { role: 'assistant', content: result.text, at: now })
      }
      // 区分「用户看到了 AI 回复」与「回复被安全闸门拦下换成了兜底话术」——
      // 否则阶段 4 的 AI 成功率统计会被拦截事件虚增。
      return { replied: true, reason: sent ? 'ok' : 'blocked' }
    },
  }
}
