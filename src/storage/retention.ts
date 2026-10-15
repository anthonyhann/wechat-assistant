import type Database from 'better-sqlite3'
import type { Logger } from '../utils/logger.js'

export interface RetentionResult {
  deleted: Record<string, number>
}

const TABLES = ['messages', 'media_files', 'conversations', 'safety_logs', 'usage_logs'] as const

/**
 * 启动时跑一次的数据清理。
 * 只删 DB 记录，不删磁盘上的媒体文件（孤儿文件清理由运维或后续任务处理）。
 */
export function runRetentionCleanup (deps: {
  db: Database.Database
  retentionDays: number
  log: Logger
}): RetentionResult {
  const { db, retentionDays, log } = deps
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
  const deleted: Record<string, number> = {}

  for (const table of TABLES) {
    const result = db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(cutoff)
    deleted[table] = result.changes
  }

  const total = Object.values(deleted).reduce((a, b) => a + b, 0)
  if (total > 0) {
    log.info('数据保留清理完成（保留 %d 天）：共删除 %d 条', retentionDays, total)
  } else {
    log.verbose('数据保留清理：无过期记录')
  }

  return { deleted }
}
