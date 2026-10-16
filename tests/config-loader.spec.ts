import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError } from '../src/config/config-loader.js'
import { PROVIDER_NAMES } from '../src/llm/providers.js'

function withConfigDir (files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'wc-config-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, 'config', name), content)
  }
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const VALID_FILES: Record<string, string> = {
  'bot.json': JSON.stringify({
    name: 'test-bot',
    trigger: { privateChat: true, roomMentionOnly: true, maxMessageAgeSeconds: 120 },
    adminServer: { enabled: true, port: 3000, token: '' },
  }),
  'backup.json': JSON.stringify({
    enabled: true, mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100,
    dedupeByHash: true, saveAllTextMessages: true, timeZone: 'Asia/Shanghai',
  }),
  'ai.json': JSON.stringify({
    provider: 'mock',
    ark: { model: 'm', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'ARK_API_KEY', temperature: 0.7, maxTokens: 1024 },
    openaiCompat: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
    memory: { enabled: true, windowSize: 10, ttlMinutes: 30 },
    systemPrompt: '你是微信群个人助理',
  }),
  'safety.json': JSON.stringify({
    localFilter: { enabled: true, wordFile: 'sensitive-words.txt' },
    llmAudit: { enabled: false, provider: 'ark' },
    fallbackReply: '这个问题我暂时无法回答',
    logInterceptions: true,
  }),
  'flows.json': JSON.stringify({
    flows: [{ name: '活动咨询', trigger: '活动|优惠', scope: 'both', enabled: true, steps: [{ type: 'say', content: '本周活动：老带新得券' }] }],
  }),
  'sensitive-words.txt': '[political]\n测试敏感词\n',
}

describe('loadConfig', () => {
  test('读取合法配置返回强类型对象', () => {
    withConfigDir(VALID_FILES, dir => {
      const config = loadConfig({ cwd: dir } as any)
      expect(config.bot.name).toBe('test-bot')
      expect(config.backup.mediaTypes).toEqual(['Image', 'Attachment'])
      expect(config.safety.llmAudit.enabled).toBe(false)
      expect(config.flows).toHaveLength(1)
      expect(config.flows[0]!.steps[0]).toEqual({ type: 'say', content: '本周活动：老带新得券' })
    })
  })

  test('缺失配置文件时抛错并指明文件名', () => {
    withConfigDir({ 'bot.json': VALID_FILES['bot.json']! }, dir => {
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(ConfigError)
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(/backup\.json/)
    })
  })

  test('mediaTypes 含非法值时抛错', () => {
    withConfigDir({ ...VALID_FILES, 'backup.json': JSON.stringify({ ...JSON.parse(VALID_FILES['backup.json']!), mediaTypes: ['Video'] }) }, dir => {
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(ConfigError)
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(/backup\.json/)
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(/Video/)
    })
  })

  test('L2 语义审核默认关闭（llmAudit.enabled=false）', () => {
    withConfigDir(VALID_FILES, dir => {
      expect(loadConfig({ cwd: dir } as any).safety.llmAudit.enabled).toBe(false)
    })
  })

  test('项目自身 config/ 目录可通过校验', () => {
    const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
    const config = loadConfig({ cwd: projectRoot } as any)
    expect(config.bot.name).toBe('wechat-assistant')
    expect(config.backup.mediaTypes).toEqual(['Image', 'Attachment'])
    expect(config.safety.llmAudit.enabled).toBe(false)
    // provider 可能被 .env 的 LLM_PROVIDER 覆盖（env 优先），
    // 故不硬编码期望值，只校验它是注册表里的合法名。
    expect(typeof config.ai.provider).toBe('string')
    expect(PROVIDER_NAMES).toContain(config.ai.provider)
    expect(config.flows.map(f => f.name)).toEqual(['活动咨询', '转人工'])
    expect(config.flows.every(f => f.steps.length > 0)).toBe(true)
  })

  // 回归：非法时区必须在加载期就失败。若放行，Intl 会在运行期抛 RangeError，
  // 而备份模块会把它吞成单条消息的 error → 所有媒体备份静默失效但进程"健康"。
  test('非法 timeZone 在加载期报错（而非运行期静默失效）', () => {
    withConfigDir({
      ...VALID_FILES,
      'backup.json': JSON.stringify({ ...JSON.parse(VALID_FILES['backup.json']!), timeZone: 'Bad/Zone' }),
    }, dir => {
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(ConfigError)
      expect(() => loadConfig({ cwd: dir } as any)).toThrowError(/timeZone/)
    })
  })

  test('合法 timeZone 通过校验', () => {
    withConfigDir({
      ...VALID_FILES,
      'backup.json': JSON.stringify({ ...JSON.parse(VALID_FILES['backup.json']!), timeZone: 'Asia/Shanghai' }),
    }, dir => {
      expect(loadConfig({ cwd: dir } as any).backup.timeZone).toBe('Asia/Shanghai')
    })
  })
})
