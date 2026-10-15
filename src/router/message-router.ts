import type { MessageRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import type { BackupModule } from '../backup/backup-module.js'
import type { SafetyGate } from '../safety/safety-gate.js'
import type { FlowEngine } from '../flow/flow-engine.js'
import { matchFlow } from '../flow/flow-engine.js'

export interface MessageRouter {
  handle (msg: any): Promise<void>
}

export interface RouterDeps {
  repo: MessageRepository
  log: Logger
  config: AppConfig
  backup?: BackupModule
  safetyGate?: SafetyGate
  flowEngine?: FlowEngine
}

/**
 * 消息路由中枢。
 * 阶段 2：过滤 → 落库 → 入站安全 → 备份 → 关键词流程。AI 在阶段 3 接入。
 */
export function createMessageRouter (deps: RouterDeps): MessageRouter {
  const { repo, log, config, backup, safetyGate, flowEngine } = deps

  return {
    async handle (msg) {
      // 1. 过滤自身消息
      if (msg.self()) {
        log.verbose('忽略自身消息: %s', msg.id)
        return
      }

      // 2. 过滤过期消息
      if (msg.age() > config.bot.trigger.maxMessageAgeSeconds) {
        log.verbose('忽略过期消息: %s (age=%ds)', msg.id, msg.age())
        return
      }

      // 3. 落库
      const room = msg.room()
      const talker = msg.talker()
      const conversationId = room ? room.id : talker.id
      const text = msg.text() || ''

      repo.insert({
        id: msg.id,
        conversation_id: conversationId,
        conversation_type: room ? 'room' : 'contact',
        talker_id: talker.id,
        talker_name: talker.name(),
        msg_type: msg.type(),
        text: text || null,
        timestamp: Date.now(),
        is_self: 0,
        handled_by: 'logged',
        safety_result: null,
        backup_result: null,
        flow_result: null,
        ai_result: null,
        created_at: Date.now(),
      })

      log.info('收到消息 %s 来自 %s 类型=%s', msg.id, room ? `群[${room.id}]` : `私聊[${talker.id}]`, msg.type())

      // 4. 入站安全：命中即终止（不回复、不跑流程、不备份）
      if (safetyGate && text) {
        const inbound = safetyGate.checkInbound(text, conversationId)
        if (inbound.matched) {
          repo.setSafetyResult(msg.id, 'blocked:inbound:L1')
          repo.setHandledBy(msg.id, 'ignored')
          log.warn('入站敏感词命中，消息被忽略 msg=%s word=%s', msg.id, inbound.word)
          return
        }
      }

      // 5. 备份分发（阶段 1）
      if (backup) {
        const outcome = await backup.handle(msg)
        repo.setResult(msg.id, 'backup_result', outcome.reason)
        repo.setHandledBy(msg.id, 'backup')
      }

      // 6. 关键词流程（阶段 2）
      if (flowEngine && text) {
        const isRoom = Boolean(room)

        // 群内需 @ 机器人；私聊无需
        let mentioned = true
        if (isRoom) {
          try {
            mentioned = await msg.mentionSelf()
          } catch {
            mentioned = false
          }
        }

        if (mentioned) {
          const flow = matchFlow(config.flows, text, isRoom ? 'room' : 'contact')
          if (flow) {
            const runResult = await flowEngine.run(flow, {
              conversationId,
              conversationType: isRoom ? 'room' : 'contact',
              isRoom,
              // 所有对外文本统一经 sendRaw（内部已由 flowEngine 过闸门）
              reply: async (t: string) => { await msg.say(t) },
              sayImage: async (p: string) => { await msg.say(p) },
            })
            repo.setResult(msg.id, 'flow_result', `matched:${flow.name}`)
            if (runResult.executed) {
              repo.setHandledBy(msg.id, 'flow')
            }
          }
        }
      }

      // 后续阶段在此分发：AI 对话模块（阶段 3）
    },
  }
}
