import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createDatabase, MessageRepository, SafetyLogRepository } from '../src/storage/db.js'

function tempDb () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-sdao-'))
  return { path: join(dir, 't.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function seedMessage (repo: MessageRepository, id = 'm1') {
  repo.insert({
    id, conversation_id: 'c1', conversation_type: 'room', talker_id: 't1',
    talker_name: '张三', msg_type: 7, text: 'hi', timestamp: 1, is_self: 0,
    handled_by: 'logged', safety_result: null,
    backup_result: null, flow_result: null, ai_result: null, created_at: 1,
  })
}

describe('messages 结果列（阶段 2 拆分列方案）', () => {
  test('新列存在且可按列更新', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      seedMessage(repo)
      repo.setResult('m1', 'backup_result', 'backed_up')
      repo.setResult('m1', 'flow_result', 'matched:活动咨询')
      expect(repo.findById('m1')!.backup_result).toBe('backed_up')
      expect(repo.findById('m1')!.flow_result).toBe('matched:活动咨询')
      db.close()
    } finally { cleanup() }
  })

  test('三个结果列互不影响', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      seedMessage(repo)
      repo.setResult('m1', 'ai_result', 'replied')
      const row = repo.findById('m1')!
      expect(row.ai_result).toBe('replied')
      expect(row.backup_result).toBeNull()
      expect(row.flow_result).toBeNull()
      db.close()
    } finally { cleanup() }
  })

  test('非法列名被拒绝（防 SQL 注入）', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      seedMessage(repo)
      expect(() => repo.setResult('m1', 'handled_by; DROP TABLE messages' as any, 'x')).toThrow()
      // 表还在
      expect(repo.findById('m1')).toBeDefined()
      db.close()
    } finally { cleanup() }
  })

  test('setSafetyResult 可写', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new MessageRepository(db)
      seedMessage(repo)
      repo.setSafetyResult('m1', 'blocked:L1')
      expect(repo.findById('m1')!.safety_result).toBe('blocked:L1')
      db.close()
    } finally { cleanup() }
  })
})

describe('SafetyLogRepository', () => {
  test('插入后可查询', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new SafetyLogRepository(db)
      repo.insert({
        direction: 'outbound', layer: 'L1', matched_word: '测试敏感词',
        snippet: '...测试敏感词...', conversation_id: 'room-1', created_at: 1700000000000,
      })
      expect(repo.countAll()).toBe(1)
      expect(repo.recent(10)[0]!.matched_word).toBe('测试敏感词')
      db.close()
    } finally { cleanup() }
  })

  test('recent 按时间倒序', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new SafetyLogRepository(db)
      repo.insert({ direction: 'inbound', layer: 'L1', matched_word: 'a', snippet: null, conversation_id: null, created_at: 1 })
      repo.insert({ direction: 'outbound', layer: 'L1', matched_word: 'b', snippet: null, conversation_id: null, created_at: 2 })
      const rows = repo.recent(10)
      expect(rows[0]!.matched_word).toBe('b')
      db.close()
    } finally { cleanup() }
  })

  test('空表 countAll 为 0 且 recent 返回空数组', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new SafetyLogRepository(db)
      expect(repo.countAll()).toBe(0)
      expect(repo.recent(10)).toEqual([])
      db.close()
    } finally { cleanup() }
  })
})

// 回归（老库升级）：CREATE TABLE IF NOT EXISTS 不会给已存在的表补列。
// 单测用新库跑，真实长驻库升级后会缺列 → 插入报 "table messages has no column named ..."。
// 该缺陷只在「用旧库打开新代码」时出现，故必须显式构造一个旧 schema 库来测。
describe('老库列迁移（createDatabase 幂等补齐）', () => {
  /** 造一个「阶段 0/1 时代」的 messages 表：没有 backup_result/flow_result/ai_result */
  function makeLegacyDb (dbPath: string): void {
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE messages (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL,
        conversation_type TEXT NOT NULL,
        talker_id         TEXT NOT NULL,
        talker_name       TEXT,
        msg_type          INTEGER NOT NULL,
        text              TEXT,
        timestamp         INTEGER NOT NULL,
        is_self           INTEGER DEFAULT 0,
        handled_by        TEXT,
        safety_result     TEXT,
        created_at        INTEGER NOT NULL
      );
    `)
    legacy.close()
  }

  test('旧库缺列时自动补齐，且可正常插入', () => {
    const { path, cleanup } = tempDb()
    try {
      makeLegacyDb(path)

      // 迁移前：确认确实是旧 schema
      const before = new Database(path)
      const beforeCols = (before.prepare('PRAGMA table_info(messages)').all() as any[]).map(c => c.name)
      expect(beforeCols).not.toContain('backup_result')
      before.close()

      // createDatabase 应补齐
      const db = createDatabase(path)
      const cols = (db.prepare('PRAGMA table_info(messages)').all() as any[]).map(c => c.name)
      expect(cols).toContain('backup_result')
      expect(cols).toContain('flow_result')
      expect(cols).toContain('ai_result')

      // 关键：补齐后插入不再报 no such column
      const repo = new MessageRepository(db)
      expect(() => seedMessage(repo, 'legacy-1')).not.toThrow()
      expect(repo.findById('legacy-1')!.backup_result).toBeNull()
      db.close()
    } finally { cleanup() }
  })

  test('迁移幂等：重复打开不报错', () => {
    const { path, cleanup } = tempDb()
    try {
      makeLegacyDb(path)
      createDatabase(path).close()
      expect(() => createDatabase(path).close()).not.toThrow()
    } finally { cleanup() }
  })

  test('迁移保留既有数据', () => {
    const { path, cleanup } = tempDb()
    try {
      makeLegacyDb(path)
      const seed = new Database(path)
      seed.prepare(`INSERT INTO messages (id, conversation_id, conversation_type, talker_id,
        talker_name, msg_type, text, timestamp, is_self, handled_by, safety_result, created_at)
        VALUES ('old-1','c1','room','t1','老张',7,'历史消息',1,0,'logged',NULL,1)`).run()
      seed.close()

      const db = createDatabase(path)
      const row = new MessageRepository(db).findById('old-1')!
      expect(row.text).toBe('历史消息')
      expect(row.talker_name).toBe('老张')
      expect(row.backup_result).toBeNull()
      db.close()
    } finally { cleanup() }
  })
})
