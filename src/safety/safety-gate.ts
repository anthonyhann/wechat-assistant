import type { SafetyLogRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import { makeSnippet, type MatchResult, type WordFilter } from './word-filter.js'

export type Verdict =
  | { safe: true; text: string }
  | { safe: false; text: string; reason: string; category: string; word: string }

export interface SafetyGate {
  /**
   * 出站检查：所有对外回复必经。
   * L1 命中 → 返回兜底话术（L3）；未命中 → 原文放行。
   */
  checkOutbound (text: string, conversationId?: string | null): Verdict
  /**
   * 入站检查：命中则记录并返回命中信息，由调用方决定是否终止处理。
   * 本函数不修改文本。
   */
  checkInbound (text: string, conversationId?: string | null): MatchResult
}

export interface SafetyGateDeps {
  wordFilter: WordFilter
  safetyRepo: SafetyLogRepository
  log: Logger
  config: AppConfig
}

let warnedDisabled = false

/**
 * 内容安全闸门。
 *
 * 层级：
 *  - L1 本地词库（必开，零成本）
 *  - L2 LLM 语义审核（**阶段 3 实现**，`config.safety.llmAudit.enabled` 为预留开关；
 *       届时在此处插入一次 LLM 调用。本阶段刻意不实现，避免引出 LLM 依赖）
 *  - L3 输出兜底（必开）：返回的 text 永远是安全文本
 */
export function createSafetyGate (deps: SafetyGateDeps): SafetyGate {
  const { wordFilter, safetyRepo, log, config } = deps

  /**
   * L3 兜底文案本身也必须干净。
   *
   * 若运维把 fallbackReply 配成含敏感词的内容（如「请联系管理员获取 sk-xxx」），
   * 命中路径会把它原样发出 —— 闸门反而成了敏感内容的出口。启动时一次性检查，
   * 命中则降级到硬编码常量并告警，绝不让脏兜底上生产线。
   */
  const HARD_FALLBACK = '这个问题我暂时无法回答，我们可以聊聊别的～'
  const configuredFallback = config.safety.fallbackReply
  const fallbackIsClean = !wordFilter.check(configuredFallback).matched
  if (!fallbackIsClean) {
    log.error(
      'safety.fallbackReply 自身命中敏感词，已降级为内置安全话术（请修正配置）: %s',
      configuredFallback,
    )
  }
  const safeFallback = fallbackIsClean ? configuredFallback : HARD_FALLBACK

  function record (direction: 'inbound' | 'outbound', text: string, category: string, word: string, conversationId?: string | null): void {
    if (!config.safety.logInterceptions) return
    try {
      safetyRepo.insert({
        direction,
        layer: 'L1',
        matched_word: word,
        snippet: makeSnippet(text, word),
        conversation_id: conversationId ?? null,
        created_at: Date.now(),
      })
    } catch (e) {
      // 审计写入失败不能影响主流程，但必须留痕
      log.error('安全日志写入失败: %s', (e as Error).message)
    }
  }

  function disabled (): boolean {
    if (config.safety.localFilter.enabled) return false
    if (!warnedDisabled) {
      warnedDisabled = true
      log.warn('安全闸门已关闭（safety.localFilter.enabled=false）——所有内容将直接放行，请确认这是预期配置')
    }
    return true
  }

  return {
    checkOutbound (text, conversationId) {
      if (disabled()) return { safe: true, text }

      const hit = wordFilter.check(text)
      if (!hit.matched) return { safe: true, text }

      record('outbound', text, hit.category, hit.word, conversationId)
      log.warn('出站内容被拦截 category=%s word=%s conv=%s', hit.category, hit.word, conversationId ?? '-')

      // L3：绝不让原文出站（兜底文案本身已在构造时校验过是干净的）
      return {
        safe: false,
        text: safeFallback,
        reason: `blocked:L1:${hit.category}`,
        category: hit.category,
        word: hit.word,
      }
    },

    checkInbound (text, conversationId) {
      if (disabled()) return { matched: false }

      const hit = wordFilter.check(text)
      if (!hit.matched) return { matched: false }

      record('inbound', text, hit.category, hit.word, conversationId)
      log.warn('入站内容命中敏感词 category=%s word=%s conv=%s', hit.category, hit.word, conversationId ?? '-')
      return hit
    },
  }
}
