import { describe, expect, test } from 'vitest'
import { WechatyBuilder } from 'wechaty'
import { PuppetMock } from 'wechaty-puppet-mock'
import { createBot } from '../src/bot/bot.js'
import { loadConfig } from '../src/config/config-loader.js'
import { createLogger } from '../src/utils/logger.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeConfig () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-bot-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'bot.json'), JSON.stringify({
    name: 'test-bot',
    trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 },
    adminServer: { enabled: false, port: 3000, token: '' },
  }))
  writeFileSync(join(dir, 'config', 'backup.json'), JSON.stringify({ enabled: true, roomWhitelistMode: 'db', mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100, dedupeByHash: true, saveAllTextMessages: true, timeZone: 'Asia/Shanghai' }))
  writeFileSync(join(dir, 'config', 'ai.json'), JSON.stringify({ provider: 'mock', ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'ARK_API_KEY', temperature: 0.7, maxTokens: 1024 }, openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'OPENAI_API_KEY' }, memory: { enabled: true, windowSize: 10, ttlMinutes: 30 }, systemPrompt: 'p' }))
  writeFileSync(join(dir, 'config', 'safety.json'), JSON.stringify({ localFilter: { enabled: true, wordFile: 'sensitive-words.txt' }, llmAudit: { enabled: false, provider: 'ark' }, fallbackReply: 'fallback', logInterceptions: true }))
  writeFileSync(join(dir, 'config', 'flows.json'), JSON.stringify({ flows: [] }))
  const config = loadConfig({ cwd: dir } as any)
  return { config, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('createBot', () => {
  test('可在 mock 协议下启动并停止', async () => {
    const { config, cleanup } = makeConfig()
    try {
      const received: string[] = []
      const bot = createBot({ config, log: createLogger('BotTest'), onMessage: msg => received.push(msg.text()) })
      await bot.start()
      expect(bot.wechaty).toBeDefined()
      await bot.stop()
      expect(true).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('error 事件不会导致进程崩溃', async () => {
    const { config, cleanup } = makeConfig()
    try {
      const bot = createBot({ config, log: createLogger('BotTest'), onMessage: () => {} })
      await bot.start()
      bot.wechaty.emit('error', new Error('boom'))
      await bot.stop()
    } finally {
      cleanup()
    }
  })
})
