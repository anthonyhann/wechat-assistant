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
  created_at: number
}

export class MessageRepository {
  constructor (private readonly db: Database.Database) {}

  insert (row: MessageRow): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, conversation_type, talker_id, talker_name,
        msg_type, text, timestamp, is_self, handled_by, safety_result, created_at)
      VALUES (@id, @conversation_id, @conversation_type, @talker_id, @talker_name,
        @msg_type, @text, @timestamp, @is_self, @handled_by, @safety_result, @created_at)
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
}
