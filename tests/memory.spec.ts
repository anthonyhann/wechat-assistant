import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, ConversationRepository } from '../src/storage/db.js'
import { createMemoryWindow, createMirroredMemory } from '../src/ai/memory.js'
import { createLogger } from '../src/utils/logger.js'

function turn (role: 'user' | 'assistant', content: string, at = Date.now()) {
  return { role, content, at }
}

describe('MemoryWindow', () => {
  test('append 后可按会话取回', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    w.append('c1', turn('user', 'a'))
    w.append('c1', turn('assistant', 'b'))
    expect(w.get('c1').map(t => t.content)).toEqual(['a', 'b'])
  })

  test('按会话隔离', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    w.append('c1', turn('user', 'a'))
    w.append('c2', turn('user', 'b'))
    expect(w.get('c1')).toHaveLength(1)
    expect(w.get('c2')).toHaveLength(1)
    expect(w.get('c2')[0]!.content).toBe('b')
  })

  test('超过 windowSize 时只保留最近 N 轮', () => {
    const w = createMemoryWindow({ windowSize: 2, ttlMinutes: 30 })
    w.append('c1', turn('user', '1'))
    w.append('c1', turn('user', '2'))
    w.append('c1', turn('user', '3'))
    expect(w.get('c1').map(t => t.content)).toEqual(['2', '3'])
  })

  test('超过 TTL 的轮次被剔除', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    const old = Date.now() - 31 * 60 * 1000
    w.append('c1', turn('user', 'old', old))
    w.append('c1', turn('user', 'new'))
    expect(w.get('c1').map(t => t.content)).toEqual(['new'])
  })

  test('全部过期时返回空数组', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    const old = Date.now() - 60 * 60 * 1000
    w.append('c1', turn('user', 'a', old))
    expect(w.get('c1')).toEqual([])
  })

  test('未涉及的会话返回空数组', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    expect(w.get('nope')).toEqual([])
  })

  test('clear 删除单个会话', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    w.append('c1', turn('user', 'a'))
    w.append('c2', turn('user', 'b'))
    w.clear('c1')
    expect(w.get('c1')).toEqual([])
    expect(w.get('c2')).toHaveLength(1)
  })

  test('size 反映会话数', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    w.append('c1', turn('user', 'a'))
    w.append('c2', turn('user', 'b'))
    expect(w.size()).toBe(2)
  })

  test('get 不改变窗口内容（幂等读取）', () => {
    const w = createMemoryWindow({ windowSize: 10, ttlMinutes: 30 })
    w.append('c1', turn('user', 'a'))
    w.get('c1'); w.get('c1')
    expect(w.get('c1')).toHaveLength(1)
  })
})

describe('ConversationRepository', () => {
  test('插入后可按会话倒序取回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-mem-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new ConversationRepository(db)
      repo.insert({ conversation_id: 'c1', role: 'user', content: 'a', created_at: 1 })
      repo.insert({ conversation_id: 'c1', role: 'assistant', content: 'b', created_at: 2 })
      const rows = repo.recentByConversation('c1', 10)
      expect(rows).toHaveLength(2)
      expect(rows[0]!.content).toBe('b')
      expect(rows[0]!.role).toBe('assistant')
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('limit 生效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-mem-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new ConversationRepository(db)
      for (let i = 0; i < 5; i++) {
        repo.insert({ conversation_id: 'c1', role: 'user', content: `m${i}`, created_at: i })
      }
      expect(repo.recentByConversation('c1', 2)).toHaveLength(2)
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('按会话隔离', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-mem-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new ConversationRepository(db)
      repo.insert({ conversation_id: 'c1', role: 'user', content: 'a', created_at: 1 })
      repo.insert({ conversation_id: 'c2', role: 'user', content: 'b', created_at: 2 })
      expect(repo.recentByConversation('c2', 10)).toHaveLength(1)
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('createMirroredMemory', () => {
  test('append 同时写窗口与 DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-mem-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const repo = new ConversationRepository(db)
      const m = createMirroredMemory({
        window: createMemoryWindow({ windowSize: 10, ttlMinutes: 30 }), repo,
      })
      m.append('c1', turn('user', 'hello'))
      expect(m.get('c1')).toHaveLength(1)
      expect(repo.recentByConversation('c1', 10)).toHaveLength(1)
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('DB 写入失败不影响窗口（主流程不中断）', () => {
    const brokenRepo = {
      insert: () => { throw new Error('db down') },
      recentByConversation: () => [],
    } as any
    const log = createLogger('MemTest')
    const errSpy = vi.fn()
    ;(log as any).error = errSpy
    const m = createMirroredMemory({
      window: createMemoryWindow({ windowSize: 10, ttlMinutes: 30 }), repo: brokenRepo, log,
    })
    expect(() => m.append('c1', turn('user', 'x'))).not.toThrow()
    expect(m.get('c1')).toHaveLength(1)
    expect(errSpy).toHaveBeenCalled()
  })
})
