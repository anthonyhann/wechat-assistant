import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, UsageRepository } from '../src/storage/db.js'

function tempDb () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-usage-'))
  return { path: join(dir, 't.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function makeRow (over: Partial<any> = {}) {
  return {
    conversation_id: 'c1', provider: 'ark', model: 'doubao-x',
    prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
    ok: 1, error: null, created_at: Date.now(), ...over,
  }
}

describe('UsageRepository', () => {
  test('插入后可查询', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new UsageRepository(db)
      repo.insert(makeRow())
      const stats = repo.todayStats()
      expect(stats.calls).toBe(1)
      expect(stats.totalTokens).toBe(150)
      db.close()
    } finally { cleanup() }
  })

  test('按日聚合统计', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new UsageRepository(db)
      const now = Date.now()
      const yesterday = now - 24 * 3600 * 1000
      repo.insert(makeRow({ created_at: now, total_tokens: 100 }))
      repo.insert(makeRow({ created_at: now, total_tokens: 200 }))
      repo.insert(makeRow({ created_at: yesterday, total_tokens: 50 }))
      const stats = repo.statsByDay(7)
      expect(stats).toHaveLength(2)
      // 今天在前（倒序）
      expect(stats[0]!.calls).toBe(2)
      expect(stats[0]!.totalTokens).toBe(300)
      expect(stats[1]!.calls).toBe(1)
      expect(stats[1]!.totalTokens).toBe(50)
      db.close()
    } finally { cleanup() }
  })

  test('失败调用也计数（ok=0）', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const repo = new UsageRepository(db)
      repo.insert(makeRow({ ok: 0, error: 'HTTP 500', prompt_tokens: null, completion_tokens: null, total_tokens: null }))
      expect(repo.todayStats().calls).toBe(1)
      expect(repo.todayStats().totalTokens).toBe(0)
      db.close()
    } finally { cleanup() }
  })

  test('空表 todayStats 返回零', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      expect(new UsageRepository(db).todayStats()).toEqual({ calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 })
      db.close()
    } finally { cleanup() }
  })

  test('老库自动获得 usage_logs 表', () => {
    const { path, cleanup } = tempDb()
    try {
      // 先建一个没有 usage_logs 的旧库
      const legacy = new (require('better-sqlite3'))(path)
      legacy.exec("CREATE TABLE messages (id TEXT PRIMARY KEY)")
      legacy.close()

      const db = createDatabase(path)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
      expect(tables).toContain('usage_logs')
      db.close()
    } finally { cleanup() }
  })
})
