import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { PROVIDER_NAMES_WITH_ALIASES } from '../llm/providers.js'

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

const ProviderOverrideSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
})

const AiConfigSchema = z.object({
  /** LLM 提供方名，来自 src/llm/providers.ts 的注册表（deepseek/qwen/glm/kimi/doubao/minimax/baichuan/openai/claude/gemini/arkcli/mock） */
  provider: z.string().min(1),
  /** 旧配置兼容节（provider=ark 时生效；新配置请用 providerOverrides） */
  ark: z.object({
    model: z.string().min(1),
    baseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
  }).optional(),
  /** 旧配置兼容节（provider=openai 时生效；新配置请用 providerOverrides） */
  openaiCompat: z.object({
    model: z.string().min(1),
    baseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
  }).optional(),
  /** 按 provider 名覆盖 preset 默认值（baseUrl / apiKeyEnv / model 均可覆盖） */
  providerOverrides: z.record(z.string(), ProviderOverrideSchema).optional(),
  /** 采样温度（所有 provider 通用，不再绑在 ark 节） */
  temperature: z.number().min(0).max(2).default(0.7),
  /** 单次回复最大 token 数 */
  maxTokens: z.number().int().positive().default(1024),
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

/**
 * 校验 flows 配置结构（供管理台 PUT /api/flows 写入前校验）。
 * 防止写入畸形配置导致下一次启动时 zod 校验失败、进程崩溃。
 */
export function validateFlowsConfig (data: unknown): { ok: true; flows: FlowConfig[] } | { ok: false; error: string } {
  const result = FlowsConfigSchema.safeParse(data)
  if (!result.success) {
    return { ok: false, error: result.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ') }
  }
  return { ok: true, flows: result.data.flows }
}

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

  // .env 的 LLM_PROVIDER 覆盖 json 的 provider（此前从未实现——
  // 导致「设了 LLM_PROVIDER=ark 却仍走 mock」的静默降级）。
  // env 优先：切换提供方是部署期行为，不该改代码仓库里的配置文件。
  const envProvider = process.env['LLM_PROVIDER']
  if (envProvider && PROVIDER_NAMES_WITH_ALIASES.includes(envProvider)) {
    aiResult.data.provider = envProvider
  } else if (envProvider) {
    throw new ConfigError(`LLM_PROVIDER=${envProvider} 不是已知 provider（可选: ${PROVIDER_NAMES_WITH_ALIASES.join(', ')}）`)
  }

  // 通用 env 覆盖（推荐）：LLM_MODEL / LLM_BASE_URL / LLM_API_KEY_ENV
  // 写进 providerOverrides，优先级高于 preset 默认值。
  // 旧变量 ARK_MODEL / ARK_BASE_URL / OPENAI_MODEL / OPENAI_BASE_URL 仍兼容。
  const provider = aiResult.data.provider
  if (process.env['LLM_MODEL'] || process.env['LLM_BASE_URL'] || process.env['LLM_API_KEY_ENV']) {
    const overrides = aiResult.data.providerOverrides ?? {}
    overrides[provider] = {
      ...overrides[provider],
      ...(process.env['LLM_MODEL'] ? { model: process.env['LLM_MODEL']! } : {}),
      ...(process.env['LLM_BASE_URL'] ? { baseUrl: process.env['LLM_BASE_URL']! } : {}),
      ...(process.env['LLM_API_KEY_ENV'] ? { apiKeyEnv: process.env['LLM_API_KEY_ENV']! } : {}),
    }
    aiResult.data.providerOverrides = overrides
  }

  // 旧变量兼容（写进旧配置节，resolveProvider 会读到）
  //
  // ⚠️ arkcli provider 例外：它走本机 arkcli 的 profile 路由，用 env 覆盖 baseUrl
  // 会让 arkcli 判定「自定义数据面端点」从而强制要求 API key（与登录态互斥）。
  // 故 provider=arkcli 时只覆盖 model，不覆盖 baseUrl。
  if (process.env['ARK_MODEL'] && aiResult.data.ark) aiResult.data.ark.model = process.env['ARK_MODEL']!
  if (process.env['ARK_BASE_URL'] && aiResult.data.provider !== 'arkcli' && aiResult.data.ark) {
    aiResult.data.ark.baseUrl = process.env['ARK_BASE_URL']!
  }
  if (process.env['OPENAI_MODEL'] && aiResult.data.openaiCompat) {
    aiResult.data.openaiCompat.model = process.env['OPENAI_MODEL']!
  }
  if (process.env['OPENAI_BASE_URL'] && aiResult.data.openaiCompat) {
    aiResult.data.openaiCompat.baseUrl = process.env['OPENAI_BASE_URL']!
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
