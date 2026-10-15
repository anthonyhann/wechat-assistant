import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/storage/db.js'
import { runRetentionCleanup } from '../src/storage/retention.js'
import { createLogger } from '../src/utils/logger.js'

function tempDb () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-ret-'))
  return { path: join(dir, 't.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const DAY = 24 * 3600 * 1000

describe('runRetentionCleanup', () => {
  test('删除超过保留期的记录，保留期内的不动', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const now = Date.now()
      const old = now - 31 * DAY

      // messages
      db.prepare(`INSERT INTO messages (id, conversation_id, conversation_type, talker_id, talker_name, msg_type, text, timestamp, is_self, handled_by, safety_result, backup_result, flow_result, ai_result, created_at)
        VALUES (?, 'c1', 'room', 't1', '张三', 7, 'old', ?, 0, 'logged', NULL, NULL, NULL, NULL, ?)`).run('old-msg', old, old)
      db.prepare(`INSERT INTO messages (id, conversation_id, conversation_type, talker_id, talker_name, msg_type, text, timestamp, is_self, handled_by, safety_result, backup_result, flow_result, ai_result, created_at)
        VALUES (?, 'c1', 'room', 't1', '张三', 7, 'new', ?, 0, 'logged', NULL, NULL, NULL, NULL, ?)`).run('new-msg', now, now)

      // conversations
      db.prepare('INSERT INTO conversations (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run('c1', 'user', 'old-conv', old)
      db.prepare('INSERT INTO conversations (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run('c1', 'user', 'new-conv', now)

      const result = runRetentionCleanup({ db, retentionDays: 30, log: createLogger('RetTest') })
      expect(result.deleted.messages).toBe(1)
      expect(result.deleted.conversations).toBe(1)

      const msgs = db.prepare('SELECT id FROM messages').all().map((r: any) => r.id)
      expect(msgs).toEqual(['new-msg'])
      db.close()
    } finally { cleanup() }
  })

  test('media_files / safety_logs / usage_logs 同步清理', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const old = Date.now() - 31 * DAY
      db.prepare(`INSERT INTO media_files (message_id, room_id, talker_id, media_type, mime, file_name, file_path, file_size, sha256, created_at)
        VALUES ('m1', 'r1', 't1', 'image', 'image/jpeg', 'a.jpg', 'p', 100, 'h', ?)`).run(old)
      db.prepare(`INSERT INTO safety_logs (direction, layer, matched_word, snippet, conversation_id, created_at) VALUES ('inbound', 'L1', 'w', 's', 'c1', ?)`).run(old)
      db.prepare(`INSERT INTO usage_logs (conversation_id, provider, model, prompt_tokens, completion_tokens, total_tokens, ok, error, created_at) VALUES ('c1', 'ark', 'm', 1, 1, 2, 1, NULL, ?)`).run(old)

      const result = runRetentionCleanup({ db, retentionDays: 30, log: createLogger('RetTest') })
      expect(result.deleted.media_files).toBe(1)
      expect(result.deleted.safety_logs).toBe(1)
      expect(result.deleted.usage_logs).toBe(1)
      db.close()
    } finally { cleanup() }
  })

  test('没有过期记录时全部返回 0', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const result = runRetentionCleanup({ db, retentionDays: 30, log: createLogger('RetTest') })
      expect(result.deleted.messages).toBe(0)
      db.close()
    } finally { cleanup() }
  })

  test('conversations 表有 created_at 索引', () => {
    const { path, cleanup } = tempDb()
    try {
      const db = createDatabase(path)
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversations'").all().map((r: any) => r.name)
      expect(indexes).toContain('idx_conv_created')
      db.close()
    } finally { cleanup() }
  })
})
