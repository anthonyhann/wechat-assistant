import { readFileSync } from 'node:fs'

/** 解析敏感词文件：`[category]` 切分节，`#` 注释与空行忽略 */
export function parseWordFile (content: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let current: string | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1).trim()
      if (current && !map.has(current)) map.set(current, [])
      continue
    }

    // 分类声明之前的词无归属，忽略
    if (current) {
      map.get(current)!.push(line)
    }
  }

  return map
}

export type MatchResult =
  | { matched: true; category: string; word: string }
  | { matched: false }

/** 本地词库过滤器（L1）。零成本、同步、可预测。 */
export class WordFilter {
  private readonly entries: Array<{ category: string; word: string; lower: string }> = []

  constructor (words: Map<string, string[]>) {
    for (const [category, list] of words) {
      for (const word of list) {
        this.entries.push({ category, word, lower: word.toLowerCase() })
      }
    }
  }

  static fromFile (filePath: string): WordFilter {
    return new WordFilter(parseWordFile(readFileSync(filePath, 'utf-8')))
  }

  /** 子串匹配（大小写不敏感），返回按词库顺序的第一个命中 */
  check (text: string): MatchResult {
    if (!text) return { matched: false }
    const lower = text.toLowerCase()

    for (const entry of this.entries) {
      if (entry.lower && lower.includes(entry.lower)) {
        return { matched: true, category: entry.category, word: entry.word }
      }
    }

    return { matched: false }
  }
}

/**
 * 生成命中词周围的上下文片段，用于 safety_logs.snippet。
 * 不落整条消息，减少审计日志中的内容留存。
 */
export function makeSnippet (text: string, word: string, radius = 10): string {
  const idx = text.toLowerCase().indexOf(word.toLowerCase())

  if (idx < 0) {
    return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2)}…`
  }

  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + word.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''

  return `${prefix}${text.slice(start, end)}${suffix}`
}
