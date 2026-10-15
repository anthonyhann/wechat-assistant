import type { MessageRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'

export interface MessageRouter {
  handle (msg: any): Promise<void>
}

export interface RouterDeps {
  repo: MessageRepository
  log: Logger
  config: AppConfig
}

/**
 * 消息路由中枢。
 * 阶段 0：只做过滤 + 落库 + 日志。备份/关键词/AI 在后续阶段接入。
 */
export function createMessageRouter (deps: RouterDeps): MessageRouter {
  const { repo, log, config } = deps

  return {
    async handle (msg) {
      // 1. 过滤自身消息
      if (msg.self()) {
        log.verbose('忽略自身消息: %s', msg.id)
        return
      }

      // 2. 过滤过期消息（重启后不处理历史积压）
      if (msg.age() > config.bot.trigger.maxMessageAgeSeconds) {
        log.verbose('忽略过期消息: %s (age=%ds)', msg.id, msg.age())
        return
      }

      // 3. 落库
      const room = msg.room()
      const talker = msg.talker()
      repo.insert({
        id: msg.id,
        conversation_id: room ? room.id : talker.id,
        conversation_type: room ? 'room' : 'contact',
        talker_id: talker.id,
        talker_name: talker.name(),
        msg_type: msg.type(),
        text: msg.text() || null,
        timestamp: Date.now(),
        is_self: 0,
        handled_by: 'logged',
        safety_result: null,
        created_at: Date.now(),
      })

      // 4. 日志
      const where = room ? `群[${room.id}]` : `私聊[${talker.id}]`
      log.info('收到消息 %s 来自 %s 类型=%s', msg.id, where, msg.type())

      // 后续阶段在此分发：备份模块 / 关键词流程引擎 / AI 对话模块
    },
  }
}
