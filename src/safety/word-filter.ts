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

/**
 * 正则规则集。
 *
 * 存在的理由：子串匹配对「短特征词」无能为力——`sk-` 只有 3 字符，
 * 放进词库会误伤 task-1 / disk-space / risk-it 等所有含该子串的正常词。
 * 但真实的 API Key 有明确的结构（前缀 + 足够长的随机段），用正则既能
 * 精准识别又不误伤。这正是设计文档 §4.1「正则 + 子串匹配」里正则的那一半。
 */
const REGEX_RULES: Array<{ category: string; name: string; re: RegExp }> = [
  // OpenAI / Anthropic 风格 key：sk- 后接 20+ 位字母数字
  { category: 'self', name: 'API Key(sk-...)', re: /sk-[A-Za-z0-9]{20,}/ },
  // ARK / 方舟风格：短横线后 24+ 位
  { category: 'self', name: 'API Key(ark-...)', re: /ark-[A-Za-z0-9]{24,}/ },
  // AWS Access Key ID
  { category: 'self', name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
]

/** 本地词库过滤器（L1）：子串匹配 + 正则规则。零成本、同步、可预测。 */
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

    // 词库未命中时再跑正则规则（结构特征，避免短词误伤）
    for (const rule of REGEX_RULES) {
      if (rule.re.test(text)) {
        return { matched: true, category: rule.category, word: rule.name }
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
