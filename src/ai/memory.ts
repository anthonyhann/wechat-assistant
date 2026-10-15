import type { Logger } from '../utils/logger.js'

export interface MemoryTurn {
  role: 'user' | 'assistant'
  content: string
  at: number
}

export interface MemoryWindow {
  append (conversationId: string, turn: MemoryTurn): void
  /** 返回未过期的最近 N 轮（按时间正序） */
  get (conversationId: string): MemoryTurn[]
  clear (conversationId: string): void
  /** 当前会话数（含已过期未清理的，供监控/测试） */
  size (): number
}

export interface MemoryWindowOptions {
  windowSize: number
  ttlMinutes: number
  log?: Logger
}

/**
 * 内存滑动窗口记忆。
 *
 * 惰性过期：不在 get 时清掉的过期轮次仍占内存，但没有定时器开销；
 * 长期不活跃的会话随 append 时的 trim 自然淘汰。
 */
export function createMemoryWindow (opts: MemoryWindowOptions): MemoryWindow {
  const { windowSize, ttlMinutes } = opts
  const ttlMs = ttlMinutes * 60_000
  const store = new Map<string, MemoryTurn[]>()

  return {
    append (conversationId, turn) {
      const list = store.get(conversationId) ?? []
      list.push(turn)
      // 只保留最近 windowSize 条（超出即淘汰最旧的）
      store.set(conversationId, list.slice(-windowSize))
    },

    get (conversationId) {
      const list = store.get(conversationId)
      if (!list) return []
      const now = Date.now()
      return list.filter(t => now - t.at <= ttlMs)
    },

    clear (conversationId) {
      store.delete(conversationId)
    },

    size () {
      return store.size
    },
  }
}

interface ConversationRepoLike {
  insert (row: { conversation_id: string; role: string; content: string; created_at: number }): void
}

/**
 * 带 DB 镜像的记忆窗口：写窗口的同时把轮次落 `conversations` 表（审计与恢复用）。
 *
 * **镜像失败绝不影响主流程** —— 否则 SQLite 问题会打断对话。失败只记 error。
 */
export function createMirroredMemory (opts: {
  window: MemoryWindow
  repo: ConversationRepoLike
  log?: Logger
}): MemoryWindow {
  const { window, repo, log } = opts

  return {
    append (conversationId, turn) {
      window.append(conversationId, turn)
      try {
        repo.insert({
          conversation_id: conversationId,
          role: turn.role,
          content: turn.content,
          created_at: turn.at,
        })
      } catch (e) {
        log?.error('conversations 镜像写入失败 conv=%s: %s', conversationId, (e as Error).message)
      }
    },
    get: (conversationId) => window.get(conversationId),
    clear: (conversationId) => window.clear(conversationId),
    size: () => window.size(),
  }
}
