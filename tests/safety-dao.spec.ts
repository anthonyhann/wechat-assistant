import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
