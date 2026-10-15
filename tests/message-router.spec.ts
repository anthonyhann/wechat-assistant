import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, MessageRepository, MediaFileRepository, WhitelistRepository } from '../src/storage/db.js'
import { createMessageRouter } from '../src/router/message-router.js'
import { createBackupModule } from '../src/backup/backup-module.js'
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
    backup: { enabled: true, mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100, dedupeByHash: true, saveAllTextMessages: true, timeZone: 'Asia/Shanghai' },
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

describe('message-router × 备份分发', () => {
  test('注入 backup 模块时被调用并更新 handled_by', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-rb-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const called: string[] = []
      const fakeBackup = {
        handle: async (msg: any) => { called.push(msg.id); return { handled: true, reason: 'backed_up' } },
      }
      const router = createMessageRouter({
        repo, log: createLogger('R'), config: makeConfig(), backup: fakeBackup as any,
      })
      const msg = fakeMsg()
      await router.handle(msg)
      expect(called).toEqual([msg.id])
      expect(repo.findById(msg.id)!.handled_by).toBe('backup:backed_up')
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('未注入 backup 时 handled_by 仍为 logged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-rb-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const router = createMessageRouter({ repo, log: createLogger('R'), config: makeConfig() })
      const msg = fakeMsg()
      await router.handle(msg)
      expect(repo.findById(msg.id)!.handled_by).toBe('logged')
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('backup 抛错不影响消息落库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-rb-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const exploding = { handle: async () => { throw new Error('boom') } }
      const router = createMessageRouter({
        repo, log: createLogger('R'), config: makeConfig(), backup: exploding as any,
      })
      const msg = fakeMsg()
      await expect(router.handle(msg)).rejects.toThrow('boom')
      expect(repo.findById(msg.id)).toBeDefined()
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 回归（组合契约）：跳过/失败的原因必须落到 handled_by。
  // 超限与失败都不写 media_files 行，handled_by 是唯一审计痕迹——
  // 若只在 handled=true 时写入，"超限被拒"与"普通文本消息"在库里无法区分。
  test.each([
    ['too_large', 'backup:too_large'],
    ['error', 'backup:error'],
    ['not_media', 'backup:not_media'],
    ['not_whitelisted', 'backup:not_whitelisted'],
    ['disabled', 'backup:disabled'],
    ['not_room', 'backup:not_room'],
  ])('backup 返回 handled=false/reason=%s 时 handled_by 记为 %s', async (reason, expected) => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-rb-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const skipping = { handle: async () => ({ handled: false, reason }) }
      const router = createMessageRouter({
        repo, log: createLogger('R'), config: makeConfig(), backup: skipping as any,
      })
      const msg = fakeMsg()
      await router.handle(msg)
      expect(repo.findById(msg.id)!.handled_by).toBe(expected)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 回归（组合契约）：真 backup 模块的超限路径，端到端验证 handled_by 标记。
  // 这条覆盖 router 与 backup-module 的接缝，单侧单测无法发现。
  test('真实 backup 模块：超限文件在 handled_by 留有 too_large 标记', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-rb-real-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new MessageRepository(db)
      const mediaRepo = new MediaFileRepository(db)
      const whitelistRepo = new WhitelistRepository(db)
      whitelistRepo.add('room-1', '测试群')

      const backup = createBackupModule({
        mediaRepo, whitelistRepo, log: createLogger('RB'), config: makeConfig(), dataDir: dir,
      })
      const router = createMessageRouter({
        repo, log: createLogger('R'), config: makeConfig(), backup,
      })
      // 图片消息，估算体积 200MB > 配置上限 100MB → 超限不下载
      const oversized = fakeMsg({
        room: () => ({ id: 'room-1', topic: async () => '测试群' }),
        type: () => 6,
        toFileBox: async () => ({
          name: 'big.jpg', mediaType: 'image/jpeg',
          size: 200 * 1024 * 1024,
          toFile: async () => { throw new Error('should not download') },
        }),
      })
      await router.handle(oversized)
      expect(repo.findById(oversized.id)!.handled_by).toBe('backup:too_large')
      expect(mediaRepo.countAll()).toBe(0)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
