#!/usr/bin/env node
import 'dotenv/config'
import { join } from 'node:path'
import { loadConfig } from './config/config-loader.js'
import { createLogger } from './utils/logger.js'
import { createDatabase, MessageRepository, MediaFileRepository, WhitelistRepository, SafetyLogRepository, ConversationRepository } from './storage/db.js'
import { createBackupModule } from './backup/backup-module.js'
import { createBot } from './bot/bot.js'
import { createMessageRouter } from './router/message-router.js'
import { WordFilter } from './safety/word-filter.js'
import { createSafetyGate } from './safety/safety-gate.js'
import { createFlowEngine } from './flow/flow-engine.js'
import { createLlmAdapter } from './llm/llm-factory.js'
import { createMemoryWindow, createMirroredMemory } from './ai/memory.js'
import { createAiModule } from './ai/ai-module.js'

async function main (): Promise<void> {
  const log = createLogger('Main')
  const config = loadConfig()

  log.info('加载配置完成，机器人名: %s', config.bot.name)

  const dbPath = process.env['DB_PATH'] || join(process.cwd(), 'data', 'wechat-assistant.sqlite')
  const db = createDatabase(dbPath)
  const repo = new MessageRepository(db)
  log.info('数据库已就绪: %s', dbPath)

  const mediaRepo = new MediaFileRepository(db)
  const whitelistRepo = new WhitelistRepository(db)
  const dataDir = process.env['DATA_DIR'] || join(process.cwd(), 'data')

  const backup = createBackupModule({ mediaRepo, whitelistRepo, log, config, dataDir })

  const safetyRepo = new SafetyLogRepository(db)
  const wordFilter = WordFilter.fromFile(
    join(process.cwd(), 'config', config.safety.localFilter.wordFile),
  )
  const safetyGate = createSafetyGate({ wordFilter, safetyRepo, log, config })
  // 流程引擎不再需要闸门 —— 闸门收口在 SafeSender 内（见 src/safety/safe-sender.ts）
  const flowEngine = createFlowEngine({ log, cooldownSeconds: 60 })

  // 阶段 3：AI 对话
  // 注意：aiModule 不持有 sender —— sender 绑定具体 msg，由 router 每条消息创建后
  // 随 chat() 传入（与 flowEngine.run 接收 ctx.sender 同一模式）。
  const llm = createLlmAdapter({ config: config.ai, log })
  const conversationRepo = new ConversationRepository(db)
  const memory = createMirroredMemory({
    window: createMemoryWindow({
      windowSize: config.ai.memory.windowSize,
      ttlMinutes: config.ai.memory.ttlMinutes,
    }),
    repo: conversationRepo,
    log,
  })
  const aiModule = createAiModule({
    llm, memory, log, config: config.ai, fallbackReply: config.safety.fallbackReply,
  })

  const router = createMessageRouter({ repo, log, config, backup, safetyGate, flowEngine, aiModule })
  const bot = createBot({ config, log, onMessage: msg => router.handle(msg) })

  const shutdown = async (signal: string) => {
    log.info('收到 %s，正在退出...', signal)
    await bot.stop()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await bot.start()
  log.info('wechat-assistant 已就绪')
}

main().catch(e => {
  console.error('启动失败:', e)
  process.exit(1)
})
