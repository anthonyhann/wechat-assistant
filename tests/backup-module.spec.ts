import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, MediaFileRepository, WhitelistRepository } from '../src/storage/db.js'
import { createBackupModule } from '../src/backup/backup-module.js'
import { createLogger } from '../src/utils/logger.js'
import type { AppConfig } from '../src/config/config-loader.js'

const IMAGE_TYPE = 6 // wechaty MessageType.Image
const TEXT_TYPE = 7

function makeConfig (over: Partial<AppConfig['backup']> = {}): AppConfig {
  return {
    bot: { name: 't', trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 }, adminServer: { enabled: false, port: 3000, token: '' } },
    backup: { enabled: true, mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100, dedupeByHash: true, saveAllTextMessages: true, timeZone: 'Asia/Shanghai', ...over },
    ai: { provider: 'mock', ark: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K', temperature: 0.7, maxTokens: 1024 }, openaiCompat: { model: 'm', baseUrl: 'https://x.com', apiKeyEnv: 'K' }, memory: { enabled: true, windowSize: 10, ttlMinutes: 30 }, systemPrompt: 'p' },
    safety: { localFilter: { enabled: true, wordFile: 'w.txt' }, llmAudit: { enabled: false, provider: 'ark' }, fallbackReply: 'fb', logInterceptions: true },
    flows: [],
  }
}

/** 造一个假消息：toFileBox 返回带 toFile 的假 FileBox */
function fakeMediaMsg (opts: {
  roomId?: string | null
  type?: number
  fileContent?: string
  fileName?: string | null
  mime?: string | null
  size?: number | null
} = {}): any {
  const { roomId = 'room-1', type = IMAGE_TYPE, fileContent = 'IMG-BYTES', fileName = 'pic.jpg', mime = 'image/jpeg', size = null } = opts
  return {
    id: 'm-' + Math.random().toString(36).slice(2),
    self: () => false,
    age: () => 1,
    type: () => type,
    text: () => '',
    room: () => (roomId ? { id: roomId, topic: async () => '测试群' } : undefined),
    talker: () => ({ id: 't1', name: () => '张三' }),
    toFileBox: async () => ({
      name: fileName ?? undefined,
      mediaType: mime ?? undefined,
      size,
      toFile: async (dest: string) => { writeFileSync(dest, fileContent) },
    }),
  }
}

function setup (configOver: Partial<AppConfig['backup']> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wc-backup-'))
  const db = createDatabase(join(dir, 't.sqlite'))
  const mediaRepo = new MediaFileRepository(db)
  const whitelistRepo = new WhitelistRepository(db)
  const log = createLogger('BackupTest')
  const config = makeConfig(configOver)
  const mod = createBackupModule({ mediaRepo, whitelistRepo, log, config, dataDir: dir })
  return { dir, db, mediaRepo, whitelistRepo, mod, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

describe('backup-module', () => {
  test('白名单群内图片被备份：落盘 + 落库', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const msg = fakeMediaMsg()
      const outcome = await s.mod.handle(msg)
      expect(outcome).toEqual({ handled: true, reason: 'backed_up' })
      expect(s.mediaRepo.countAll()).toBe(1)

      const row = s.db.prepare('SELECT * FROM media_files').get() as any
      expect(row.message_id).toBe(msg.id)
      expect(row.room_id).toBe('room-1')
      expect(row.media_type).toBe('image')
      expect(row.mime).toBe('image/jpeg')
      expect(row.file_name).toBe('pic.jpg')
      expect(row.file_size).toBe(Buffer.byteLength('IMG-BYTES'))
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
      // file_path 是相对路径，且对应文件真实存在
      expect(existsSync(join(s.dir, row.file_path))).toBe(true)
    } finally { s.cleanup() }
  })

  test('白名单群内文件（Attachment）被备份', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const outcome = await s.mod.handle(fakeMediaMsg({ type: 8, fileName: '报价单.pdf', mime: 'application/pdf' }))
      expect(outcome).toEqual({ handled: true, reason: 'backed_up' })
      const row = s.db.prepare('SELECT * FROM media_files').get() as any
      expect(row.media_type).toBe('attachment')
      expect(row.file_name).toBe('报价单.pdf')
      expect(row.file_path).toMatch(/\.pdf$/)
    } finally { s.cleanup() }
  })

  test('非白名单群不备份', async () => {
    const s = setup()
    try {
      const outcome = await s.mod.handle(fakeMediaMsg({ roomId: 'room-other' }))
      expect(outcome).toEqual({ handled: false, reason: 'not_whitelisted' })
      expect(s.mediaRepo.countAll()).toBe(0)
    } finally { s.cleanup() }
  })

  test('私聊消息不备份（备份仅针对白名单群）', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const outcome = await s.mod.handle(fakeMediaMsg({ roomId: null }))
      expect(outcome).toEqual({ handled: false, reason: 'not_room' })
      expect(s.mediaRepo.countAll()).toBe(0)
    } finally { s.cleanup() }
  })

  test('文本消息不备份', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const outcome = await s.mod.handle(fakeMediaMsg({ type: TEXT_TYPE }))
      expect(outcome).toEqual({ handled: false, reason: 'not_media' })
      expect(s.mediaRepo.countAll()).toBe(0)
    } finally { s.cleanup() }
  })

  test('backup.enabled=false 时整体关闭', async () => {
    const s = setup({ enabled: false })
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const outcome = await s.mod.handle(fakeMediaMsg())
      expect(outcome).toEqual({ handled: false, reason: 'disabled' })
      expect(s.mediaRepo.countAll()).toBe(0)
    } finally { s.cleanup() }
  })

  test('同内容第二条消息去重：磁盘 1 个文件，media_files 2 行', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const first = fakeMediaMsg()
      const second = fakeMediaMsg() // 不同 msg.id，但文件内容相同
      const o1 = await s.mod.handle(first)
      const o2 = await s.mod.handle(second)
      expect(o1).toEqual({ handled: true, reason: 'backed_up' })
      expect(o2).toEqual({ handled: true, reason: 'deduped' })

      const rows = s.db.prepare('SELECT * FROM media_files ORDER BY id').all() as any[]
      expect(rows).toHaveLength(2)
      // 两条记录指向同一个文件（第二个消息复用了已有文件路径）
      expect(rows[0]!.file_path).toBe(rows[1]!.file_path)
      expect(rows[0]!.sha256).toBe(rows[1]!.sha256)
      // 该文件真实存在
      expect(existsSync(join(s.dir, rows[1]!.file_path))).toBe(true)
      // 磁盘上只应有 1 个媒体文件（第二个已删除）
      const mediaFiles = readdirSync(join(s.dir, 'media', 'room-1'), { recursive: true }) as string[]
      const actualFiles = mediaFiles.filter(f => String(f).endsWith('.jpg'))
      expect(actualFiles).toHaveLength(1)
    } finally { s.cleanup() }
  })

  test('体积超限不下载、不落库', async () => {
    const s = setup({ maxFileSizeMB: 1 })
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const outcome = await s.mod.handle(fakeMediaMsg({ size: 2 * 1024 * 1024 }))
      expect(outcome).toEqual({ handled: false, reason: 'too_large' })
      expect(s.mediaRepo.countAll()).toBe(0)
      // 未落盘：media 目录下不应有任何文件
      expect(existsSync(join(s.dir, 'media'))).toBe(false)
    } finally { s.cleanup() }
  })

  test('toFileBox 抛错时返回 error 且不向上抛出', async () => {
    const s = setup()
    try {
      s.whitelistRepo.add('room-1', '测试群')
      const msg = fakeMediaMsg()
      msg.toFileBox = async () => { throw new Error('puppet boom') }
      const outcome = await s.mod.handle(msg)
      expect(outcome).toEqual({ handled: false, reason: 'error' })
      expect(s.mediaRepo.countAll()).toBe(0)
    } finally { s.cleanup() }
  })
})
