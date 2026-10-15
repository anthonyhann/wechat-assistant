import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DDL = `
CREATE TABLE IF NOT EXISTS messages (
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
  backup_result     TEXT,
  flow_result       TEXT,
  ai_result         TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS media_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL,
  room_id     TEXT,
  talker_id   TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  mime        TEXT,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER,
  sha256      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_msg ON media_files(message_id);

CREATE TABLE IF NOT EXISTS whitelist_rooms (
  room_id    TEXT PRIMARY KEY,
  room_name  TEXT,
  enabled    INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  scope      TEXT DEFAULT 'both',
  enabled    INTEGER DEFAULT 1,
  steps_json TEXT NOT NULL,
  hit_count  INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS safety_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  direction       TEXT NOT NULL,
  layer           TEXT NOT NULL,
  matched_word    TEXT,
  snippet         TEXT,
  conversation_id TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
`

export function createDatabase (dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(DDL)
  return db
}

export interface MessageRow {
  id: string
  conversation_id: string
  conversation_type: 'contact' | 'room'
  talker_id: string
  talker_name: string | null
  msg_type: number
  text: string | null
  timestamp: number
  is_self: number
  handled_by: string | null
  safety_result: string | null
  backup_result: string | null
  flow_result: string | null
  ai_result: string | null
  created_at: number
}

export class MessageRepository {
  constructor (private readonly db: Database.Database) {}

  insert (row: MessageRow): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, conversation_type, talker_id, talker_name,
        msg_type, text, timestamp, is_self, handled_by, safety_result,
        backup_result, flow_result, ai_result, created_at)
      VALUES (@id, @conversation_id, @conversation_type, @talker_id, @talker_name,
        @msg_type, @text, @timestamp, @is_self, @handled_by, @safety_result,
        @backup_result, @flow_result, @ai_result, @created_at)
      ON CONFLICT(id) DO NOTHING
    `).run(row)
  }

  countByConversation (conversationId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?').get(conversationId) as { c: number }
    return row.c
  }

  recent (limit: number): MessageRow[] {
    return this.db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?').all(limit) as MessageRow[]
  }

  setHandledBy (id: string, handledBy: string): void {
    this.db.prepare('UPDATE messages SET handled_by = ? WHERE id = ?').run(handledBy, id)
  }

  private static readonly RESULT_COLUMNS = ['backup_result', 'flow_result', 'ai_result'] as const

  /**
   * 更新消息的某个结果列。
   * 列名走白名单校验 —— 列名无法用参数绑定，必须防注入。
   */
  setResult (id: string, column: 'backup_result' | 'flow_result' | 'ai_result', value: string): void {
    if (!MessageRepository.RESULT_COLUMNS.includes(column)) {
      throw new Error(`非法的结果列名: ${String(column)}`)
    }
    // 列名来自上面校验过的白名单，此处拼接安全
    this.db.prepare(`UPDATE messages SET ${column} = ? WHERE id = ?`).run(value, id)
  }

  setSafetyResult (id: string, value: string): void {
    this.db.prepare('UPDATE messages SET safety_result = ? WHERE id = ?').run(value, id)
  }

  findById (id: string): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  }
}

export interface MediaFileRow {
  id?: number
  message_id: string
  room_id: string | null
  talker_id: string
  media_type: string
  mime: string | null
  file_name: string
  file_path: string
  file_size: number | null
  sha256: string | null
  created_at: number
}

export class MediaFileRepository {
  constructor (private readonly db: Database.Database) {}

  insert (row: MediaFileRow): void {
    this.db.prepare(`
      INSERT INTO media_files (message_id, room_id, talker_id, media_type, mime,
        file_name, file_path, file_size, sha256, created_at)
      VALUES (@message_id, @room_id, @talker_id, @media_type, @mime,
        @file_name, @file_path, @file_size, @sha256, @created_at)
    `).run({
      message_id: row.message_id,
      room_id: row.room_id,
      talker_id: row.talker_id,
      media_type: row.media_type,
      mime: row.mime,
      file_name: row.file_name,
      file_path: row.file_path,
      file_size: row.file_size,
      sha256: row.sha256,
      created_at: row.created_at,
    })
  }

  findBySha256 (sha256: string): MediaFileRow | undefined {
    return this.db.prepare('SELECT * FROM media_files WHERE sha256 = ? LIMIT 1').get(sha256) as MediaFileRow | undefined
  }

  countAll (): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM media_files').get() as { c: number }
    return row.c
  }
}

export class WhitelistRepository {
  constructor (private readonly db: Database.Database) {}

  add (roomId: string, roomName: string | null): void {
    this.db.prepare(`
      INSERT INTO whitelist_rooms (room_id, room_name, enabled, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(room_id) DO UPDATE SET room_name = excluded.room_name,
        enabled = 1, updated_at = excluded.updated_at
    `).run(roomId, roomName, Date.now())
  }

  isEnabled (roomId: string): boolean {
    const row = this.db.prepare('SELECT enabled FROM whitelist_rooms WHERE room_id = ?').get(roomId) as { enabled: number } | undefined
    return row?.enabled === 1
  }

  list (): Array<{ room_id: string; room_name: string | null; enabled: number }> {
    return this.db.prepare('SELECT room_id, room_name, enabled FROM whitelist_rooms ORDER BY room_id').all() as Array<{ room_id: string; room_name: string | null; enabled: number }>
  }

  remove (roomId: string): void {
    this.db.prepare('DELETE FROM whitelist_rooms WHERE room_id = ?').run(roomId)
  }
}

export interface SafetyLogRow {
  direction: 'inbound' | 'outbound'
  layer: string
  matched_word: string | null
  snippet: string | null
  conversation_id: string | null
  created_at: number
}

export class SafetyLogRepository {
  constructor (private readonly db: Database.Database) {}

  insert (row: SafetyLogRow): void {
    this.db.prepare(`
      INSERT INTO safety_logs (direction, layer, matched_word, snippet, conversation_id, created_at)
      VALUES (@direction, @layer, @matched_word, @snippet, @conversation_id, @created_at)
    `).run(row)
  }

  recent (limit: number): SafetyLogRow[] {
    return this.db.prepare('SELECT * FROM safety_logs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as SafetyLogRow[]
  }

  countAll (): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM safety_logs').get() as { c: number }
    return row.c
  }
}
