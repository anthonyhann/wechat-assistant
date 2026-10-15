import type { MessageRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import type { BackupModule } from '../backup/backup-module.js'
import type { SafetyGate } from '../safety/safety-gate.js'
import type { FlowEngine } from '../flow/flow-engine.js'
import { matchFlow } from '../flow/flow-engine.js'
import { FileBox } from 'file-box'

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
          } catch (e) {
            // 某些 puppet 不支持 mentionSelf。视为未 @（宁可漏触发也不让整条消息处理崩掉），
            // 但必须留痕——否则会表现为「用户 @ 了机器人却永远没响应」的静默故障。
            mentioned = false
            log.warn('mentionSelf() 调用失败，按未 @ 处理 msg=%s: %s', msg.id, (e as Error).message)
          }
        }

        if (mentioned) {
          const flow = matchFlow(config.flows, text, isRoom ? 'room' : 'contact')
          if (flow) {
            const runResult = await flowEngine.run(flow, {
              conversationId,
              conversationType: isRoom ? 'room' : 'contact',
              isRoom,
              // 所有对外文本统一经 flowEngine（内部每步都过 checkOutbound 闸门）
              reply: async (t: string) => { await msg.say(t) },
              // 必须包成 FileBox：wechaty 的 sayableToPayload 对 string 走文字分支，
              // 直接传路径会把 "/path/x.png" 当文本发出去（用户看到一串路径而非图片）。
              sayImage: async (p: string) => { await msg.say(FileBox.fromFile(p)) },
            })
            // 记录命中的流程名与执行结果。
            // reason 体现 cooldown / no_executable_steps / error 等分支 —— 阶段 4 管理台
            // 排查「为什么这条消息没回复」时需要它，丢掉就只能看到「命中了但没动静」。
            repo.setResult(msg.id, 'flow_result', `matched:${flow.name}:${runResult.reason}`)
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
