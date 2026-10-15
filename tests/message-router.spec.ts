import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, MessageRepository } from '../src/storage/db.js'
import { createMessageRouter } from '../src/router/message-router.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'

function fakeMsg (overrides: Partial<any> = {}): any {
  return {
    id: 'm-' + Math.random(),
    self: () => false,
    age: () => 10,
    text: () => 'hello',
    type: () => 7,
    talker: () => ({ id: 't1', name: () => '张三' }),
    room: () => undefined,
    ...overrides,
  }
}

function makeConfig (): AppConfig {
  return {
    bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: false, port: 3000, token: '' } },
    backup: { enabled: true, mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100, dedupeByHash: true, saveAllTextMessages: true },
    ai: { provider: 'mock', ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K', temperature: 0.7, maxTokens: 1024 }, openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K' }, memory: { enabled: true, windowSize: 10, ttlMinutes: 30 }, systemPrompt: 'p' },
    safety: { localFilter: { enabled: true, wordFile: 'w.txt' }, llmAudit: { enabled: false, provider: 'ark' }, fallbackReply: 'fb', logInterceptions: true },
    flows: [],
  }
}

describe('message-router（阶段 0）', () => {
  test('普通消息被落库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-router-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const router = createMessageRouter({ repo, log: createLogger('R'), config: makeConfig() })
      await router.handle(fakeMsg())
      expect(repo.recent(10)).toHaveLength(1)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('自身消息被忽略', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-router-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const router = createMessageRouter({ repo, log: createLogger('R'), config: makeConfig() })
      await router.handle(fakeMsg({ self: () => true }))
      expect(repo.recent(10)).toHaveLength(0)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('过期消息被忽略', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-router-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const router = createMessageRouter({ repo, log: createLogger('R'), config: makeConfig() })
      await router.handle(fakeMsg({ age: () => 999 }))
      expect(repo.recent(10)).toHaveLength(0)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('群消息按群维度落库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-router-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const router = createMessageRouter({ repo, log: createLogger('R'), config: makeConfig() })
      const room = { id: 'room-1', topic: () => vi.fn(() => Promise.resolve('测试群')) }
      await router.handle(fakeMsg({ room: () => room }))
      const rows = repo.recent(10)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.conversation_id).toBe('room-1')
      expect(rows[0]!.conversation_type).toBe('room')
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
