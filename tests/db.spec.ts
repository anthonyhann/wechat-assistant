import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, MessageRepository, type MessageRow } from '../src/storage/db.js'

function tempDb (): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'wc-db-'))
  return { path: join(dir, 'test.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('SQLite 存储层', () => {
  test('建表：5 张表全部存在', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r: any) => r.name).sort()
      expect(tables).toEqual(['conversations', 'flows', 'media_files', 'messages', 'safety_logs', 'whitelist_rooms'])
      db.close()
    } finally {
      cleanup()
    }
  })

  test('messages 表可插入并可查询', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      const row: MessageRow = {
        id: 'msg-1', conversation_id: 'conv-1', conversation_type: 'contact',
        talker_id: 'talker-1', talker_name: '张三', msg_type: 7, text: '你好',
        timestamp: 1700000000000, is_self: 0, handled_by: null, safety_result: null, created_at: 1700000000000,
      }
      repo.insert(row)
      expect(repo.countByConversation('conv-1')).toBe(1)
      expect(repo.recent(10)).toHaveLength(1)
      expect(repo.recent(10)[0]!.text).toBe('你好')
      db.close()
    } finally {
      cleanup()
    }
  })

  test('重复插入同一消息 ID 不报错（幂等）', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      const row: MessageRow = {
        id: 'msg-dup', conversation_id: 'conv-1', conversation_type: 'contact',
        talker_id: 'talker-1', talker_name: null, msg_type: 7, text: 'hi',
        timestamp: 1700000000000, is_self: 0, handled_by: null, safety_result: null, created_at: 1700000000000,
      }
      repo.insert(row)
      expect(() => repo.insert(row)).not.toThrow()
      expect(repo.countByConversation('conv-1')).toBe(1)
      db.close()
    } finally {
      cleanup()
    }
  })
})
