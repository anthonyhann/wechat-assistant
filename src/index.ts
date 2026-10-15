#!/usr/bin/env node
import 'dotenv/config'
import { join } from 'node:path'
import { loadConfig } from './config/config-loader.js'
import { createLogger } from './utils/logger.js'
import { createDatabase, MessageRepository, MediaFileRepository, WhitelistRepository } from './storage/db.js'
import { createBackupModule } from './backup/backup-module.js'
import { createBot } from './bot/bot.js'
import { createMessageRouter } from './router/message-router.js'

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
  const router = createMessageRouter({ repo, log, config, backup })
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
