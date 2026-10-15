import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDatabase, MessageRepository, MediaFileRepository, WhitelistRepository,
  type MediaFileRow,
} from '../src/storage/db.js'

function tempDb () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-repo-'))
  return { path: join(dir, 't.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const sampleMedia = (over: Partial<MediaFileRow> = {}): MediaFileRow => ({
  message_id: 'm1', room_id: 'r1', talker_id: 't1', media_type: 'image',
  mime: 'image/jpeg', file_name: 'a.jpg', file_path: 'data/media/r1/2026-08-13/m1.jpg',
  file_size: 1024, sha256: 'abc', created_at: 1700000000000, ...over,
})

describe('MediaFileRepository', () => {
  test('插入后可按 sha256 查到', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MediaFileRepository(db)
      repo.insert(sampleMedia())
      expect(repo.countAll()).toBe(1)
      expect(repo.findBySha256('abc')!.file_name).toBe('a.jpg')
      db.close()
    } finally { cleanup() }
  })

  test('sha256 不存在时返回 undefined', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MediaFileRepository(db)
      expect(repo.findBySha256('nope')).toBeUndefined()
      db.close()
    } finally { cleanup() }
  })
})

describe('WhitelistRepository', () => {
  test('add 后可判定为启用', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new WhitelistRepository(db)
      repo.add('room-1', '测试群')
      expect(repo.isEnabled('room-1')).toBe(true)
      expect(repo.isEnabled('room-2')).toBe(false)
      expect(repo.list()).toHaveLength(1)
      db.close()
    } finally { cleanup() }
  })

  test('add 幂等（同 roomId 重复 add 不报错且名称更新）', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new WhitelistRepository(db)
      repo.add('room-1', '旧名')
      repo.add('room-1', '新名')
      expect(repo.list()).toHaveLength(1)
      expect(repo.list()[0]!.room_name).toBe('新名')
      db.close()
    } finally { cleanup() }
  })

  test('remove 后判定为不启用', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new WhitelistRepository(db)
      repo.add('room-1', 'x')
      repo.remove('room-1')
      expect(repo.isEnabled('room-1')).toBe(false)
      db.close()
    } finally { cleanup() }
  })
})

describe('MessageRepository 扩展', () => {
  test('setHandledBy 可更新标记', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      repo.insert({
        id: 'm1', conversation_id: 'c1', conversation_type: 'room', talker_id: 't1',
        talker_name: '张三', msg_type: 7, text: 'hi', timestamp: 1, is_self: 0,
        handled_by: 'logged', safety_result: null,
        backup_result: null, flow_result: null, ai_result: null, created_at: 1,
      })
      repo.setHandledBy('m1', 'backup')
      expect(repo.findById('m1')!.handled_by).toBe('backup')
      db.close()
    } finally { cleanup() }
  })

  test('findById 不存在时返回 undefined', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      expect(repo.findById('nope')).toBeUndefined()
      db.close()
    } finally { cleanup() }
  })
})
