import type { MessageRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import type { BackupModule } from '../backup/backup-module.js'
import type { SafetyGate } from '../safety/safety-gate.js'
import type { FlowEngine } from '../flow/flow-engine.js'
import type { AiModule } from '../ai/ai-module.js'
import { matchFlow } from '../flow/flow-engine.js'
import { createSafeSender } from '../safety/safe-sender.js'

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
  aiModule?: AiModule
}

/**
 * 消息路由中枢。
 * 阶段 2：过滤 → 落库 → 入站安全 → 备份 → 关键词流程。
 * 阶段 3：流程未处理时按触发策略分发 AI 对话（与流程互斥）。
 */
export function createMessageRouter (deps: RouterDeps): MessageRouter {
  const { repo, log, config, backup, safetyGate, flowEngine, aiModule } = deps

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
        // 初值留 NULL 而非 'logged'：'logged' 不在设计文档的枚举里
        // （'backup'|'flow'|'ai'|'ignored'），若以它落库，阶段 4 用
        // `handled_by IS NULL` 查「未处理/异常」时会一条都查不到——失败被伪装成处理过。
        // 每条消息最终必然由下面某个分支写明责任人。
        handled_by: null,
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
          // 明确写出"备份被安全闸门跳过"，否则后续审计无法区分
          // 「被闸门拦下」与「puppet 没提供 FileBox 而失败」——两者的 backup_result 都是 NULL。
          repo.setResult(msg.id, 'backup_result', 'skipped:inbound_blocked')
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
      // flowEngine 与 safetyGate 必须同时存在：发送通道 SafeSender 内含闸门，
      // 缺闸门就不允许创建 sender（宁可流程不跑，也不能出现无闸门的出口）。
      let flowHandled = false
      if (flowEngine && safetyGate && text) {
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
            // 唯一发送通道：内含安全闸门与 FileBox 封装。
            // 下游模块（流程引擎 / 阶段3 AI）只拿得到 sender，拿不到 msg ——
            // 从结构上杜绝「绕过闸门的 msg.say」。
            const sender = createSafeSender({ target: msg, safetyGate, log, conversationId })
            const runResult = await flowEngine.run(flow, {
              conversationId,
              conversationType: isRoom ? 'room' : 'contact',
              isRoom,
              sender,
            })
            // 记录命中的流程名与执行结果。
            // reason 体现 cooldown / no_executable_steps / error 等分支 —— 阶段 4 管理台
            // 排查「为什么这条消息没回复」时需要它，丢掉就只能看到「命中了但没动静」。
            repo.setResult(msg.id, 'flow_result', `matched:${flow.name}:${runResult.reason}`)
            // 命中流程时责任人一律写成 'flow'（包括 cooldown/error 等未成功执行的情况）：
            // 归一化为「由流程模块负责处理」，具体结果看 flow_result。
            // 若只在成功时写，未成功且此前未备份的消息会留下 handled_by=NULL，
            // 与「根本没被任何模块处理」无法区分。
            repo.setHandledBy(msg.id, 'flow')
            // 互斥只针对「命中并执行」的流程（用户确认）。命中但未执行
            // （cooldown / no_executable_steps / error）时流程没有产出任何回复，
            // 此时不放行 AI 会让用户 @ 机器人却毫无响应——表现为静默故障。
            flowHandled = runResult.executed
          }
        }
      }

      // 7. AI 对话（阶段 3）
      // 触发条件（用户确认）：流程未处理 + (私聊 OR 群内已 @)
      // 与流程互斥：流程命中就不再走 AI，避免「活动」类指令同时收到话术 + AI 回复。
      if (aiModule && safetyGate && text && !flowHandled) {
        const isRoom = Boolean(room)
        let shouldChat = !isRoom

        if (isRoom) {
          try {
            shouldChat = await msg.mentionSelf()
          } catch (e) {
            shouldChat = false
            log.warn('mentionSelf() 调用失败，AI 不触发 msg=%s: %s', msg.id, (e as Error).message)
          }
        }

        if (shouldChat) {
          // 群内消息形如「@机器人 今天天气」——必须剥离 @ 前缀再给 LLM，
          // 否则模型会看到无意义的 @ 文本。
          let promptText = text
          if (isRoom && typeof msg.mentionText === 'function') {
            try {
              promptText = await msg.mentionText()
            } catch {
              promptText = text
            }
          }

          const sender = createSafeSender({ target: msg, safetyGate, log, conversationId })
          const aiResult = await aiModule.chat(conversationId, promptText, sender)
          repo.setResult(msg.id, 'ai_result', aiResult.reason)
          repo.setHandledBy(msg.id, 'ai')
        }
      }

      // 兜底：走到这里说明消息被收下并落库、但没有任何模块认领（无备份模块、
      // 或文本不触发流程）。标记为 'ignored' 而非留 NULL，让「无人认领」是显式状态，
      // 阶段 4 便可直接用 `handled_by = 'ignored'` 统计，而 `handled_by IS NULL`
      // 则专指「处理中途异常/漏写」这一异常信号。
      if (repo.findById(msg.id)?.handled_by == null) {
        repo.setHandledBy(msg.id, 'ignored')
      }
    },
  }
}
