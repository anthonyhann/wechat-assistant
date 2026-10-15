import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError } from '../src/config/config-loader.js'

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
    enabled: true, roomWhitelistMode: 'db', mediaTypes: ['Image', 'Attachment'], maxFileSizeMB: 100,
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
    expect(config.ai.provider).toBe('mock')
    expect(config.flows.map(f => f.name)).toEqual(['活动咨询', '转人工'])
    expect(config.flows.every(f => f.steps.length > 0)).toBe(true)
  })
})
