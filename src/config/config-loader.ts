import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export class ConfigError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * 校验是否为合法的 IANA 时区名。
 * 非法值会在运行期由 Intl 抛 RangeError —— 而备份模块会把它吞成单条消息的
 * error，表现为「所有媒体备份静默失效但进程健康」。故在配置加载期就失败。
 */
function isValidTimeZone (tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const FlowStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), content: z.string().min(1) }),
  z.object({ type: z.literal('image'), path: z.string().min(1) }),
  z.object({ type: z.literal('handoff'), channel: z.string().min(1) }),
  z.object({ type: z.literal('http'), url: z.string().url(), method: z.enum(['GET', 'POST']), bodyTemplate: z.string().optional() }),
])

const FlowSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  scope: z.enum(['room', 'contact', 'both']),
  enabled: z.boolean(),
  steps: z.array(FlowStepSchema).min(1),
})

const BotConfigSchema = z.object({
  name: z.string().min(1),
  trigger: z.object({
    privateChat: z.boolean(),
    roomMentionOnly: z.boolean(),
    maxMessageAgeSeconds: z.number().int().positive(),
  }),
  adminServer: z.object({
    enabled: z.boolean(),
    port: z.number().int().positive(),
    token: z.string(),
  }),
})

const BackupConfigSchema = z.object({
  enabled: z.boolean(),
  mediaTypes: z.array(z.enum(['Image', 'Attachment'])).min(1),
  maxFileSizeMB: z.number().positive(),
  dedupeByHash: z.boolean(),
  saveAllTextMessages: z.boolean(),
  // 媒体目录按哪个时区分日；缺省 Asia/Shanghai，避免容器 TZ=UTC 时凌晨消息落到前一天
  timeZone: z.string().default('Asia/Shanghai').refine(isValidTimeZone, {
    message: '不是合法的 IANA 时区名（如 Asia/Shanghai）',
  }),
  /** 数据保留天数（messages / media_files / conversations / safety_logs / usage_logs） */
  retentionDays: z.number().int().positive().default(30),
})

const AiConfigSchema = z.object({
  provider: z.enum(['mock', 'ark', 'openai']),
  ark: z.object({
    model: z.string().min(1),
    baseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
  }),
  openaiCompat: z.object({
    model: z.string().min(1),
    baseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
  }),
  memory: z.object({
    enabled: z.boolean(),
    windowSize: z.number().int().positive(),
    ttlMinutes: z.number().positive(),
  }),
  systemPrompt: z.string().min(1),
  /** AI 调用节流：同一对话多少秒内最多 1 次（0=不节流） */
  throttleSeconds: z.number().int().min(0).default(10),
  /** 单条用户消息最大字符数（超出截断） */
  maxPromptChars: z.number().int().positive().default(8000),
})

const SafetyConfigSchema = z.object({
  localFilter: z.object({ enabled: z.boolean(), wordFile: z.string().min(1) }),
  llmAudit: z.object({ enabled: z.boolean(), provider: z.enum(['ark', 'openai']) }),
  fallbackReply: z.string().min(1),
  logInterceptions: z.boolean(),
})

const FlowsConfigSchema = z.object({ flows: z.array(FlowSchema) })

export type FlowStep = z.infer<typeof FlowStepSchema>
export type FlowConfig = z.infer<typeof FlowSchema>
export type BotConfig = z.infer<typeof BotConfigSchema>
export type BackupConfig = z.infer<typeof BackupConfigSchema>
export type AiConfig = z.infer<typeof AiConfigSchema>
export type SafetyConfig = z.infer<typeof SafetyConfigSchema>

export interface AppConfig {
  bot: BotConfig
  backup: BackupConfig
  ai: AiConfig
  safety: SafetyConfig
  flows: FlowConfig[]
}

function readJson (dir: string, fileName: string): unknown {
  const filePath = join(dir, 'config', fileName)
  if (!existsSync(filePath)) {
    throw new ConfigError(`配置文件缺失: config/${fileName}（路径: ${filePath}）`)
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    throw new ConfigError(`配置文件不是合法 JSON: config/${fileName} - ${(e as Error).message}`)
  }
}

/**
 * 加载并校验全部配置。
 * @param options.cwd 项目根目录，默认 process.cwd()
 */
export function loadConfig (options?: { cwd?: string }): AppConfig {
  const cwd = options?.cwd ?? process.cwd()

  const botResult = BotConfigSchema.safeParse(readJson(cwd, 'bot.json'))
  if (!botResult.success) {
    throw new ConfigError(`config/bot.json 校验失败: ${botResult.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }

  const backupResult = BackupConfigSchema.safeParse(readJson(cwd, 'backup.json'))
  if (!backupResult.success) {
    throw new ConfigError(`config/backup.json 校验失败: ${backupResult.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }

  const aiResult = AiConfigSchema.safeParse(readJson(cwd, 'ai.json'))
  if (!aiResult.success) {
    throw new ConfigError(`config/ai.json 校验失败: ${aiResult.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }

  const safetyResult = SafetyConfigSchema.safeParse(readJson(cwd, 'safety.json'))
  if (!safetyResult.success) {
    throw new ConfigError(`config/safety.json 校验失败: ${safetyResult.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }

  const flowsResult = FlowsConfigSchema.safeParse(readJson(cwd, 'flows.json'))
  if (!flowsResult.success) {
    throw new ConfigError(`config/flows.json 校验失败: ${flowsResult.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }

  return {
    bot: botResult.data,
    backup: backupResult.data,
    ai: aiResult.data,
    safety: safetyResult.data,
    flows: flowsResult.data.flows,
  }
}
