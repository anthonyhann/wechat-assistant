import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, UsageRepository, ConversationRepository } from '../src/storage/db.js'
import type { LlmAdapter } from '../src/llm/llm-interface.js'
import { createMirroredMemory, createMemoryWindow } from '../src/ai/memory.js'
import { createAiModule } from '../src/ai/ai-module.js'
import { createLogger } from '../src/utils/logger.js'
import { loadConfig } from '../src/config/config-loader.js'
import { PROVIDER_NAMES } from '../src/llm/providers.js'
import type { SafeSender } from '../src/safety/safe-sender.js'

/**
 * 装配契约回归：复刻 src/index.ts 的 AI 组装链，验证 usage 落库。
 *
 * 背景：阶段 4 终审发现 index.ts 的 createAiModule 漏传 usageRepo，
 * 导致 usage_logs 在生产中永远为空，而单侧的 Task1/Task5 测试都各自注入
 * 手工 repo —— 没有任何测试覆盖「装配把它们连起来」。本用例锁定该契约。
 */
describe('装配契约：AI 模块的 usage 落库', () => {
  test('按 index.ts 的调用签名组装后，chat 会落 usage_logs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-wire-'))
    try {
      const db = createDatabase(join(dir, 't.sqlite'))
      const config = loadConfig()
      const log = createLogger('WireTest')

      // 用可控的 mock adapter，避免依赖 .env/真实 key（CI 环境无 .env）。
      // 本用例验证的是「装配链接通后 usage 会落库」，不是某个真实 provider 的行为。
      const mockLlm: LlmAdapter = {
        name: 'mock',
        async complete () {
          return { ok: true as const, text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        },
      }

      // 与 src/index.ts 完全相同的组装顺序与调用签名
      const llm = mockLlm
      const conversationRepo = new ConversationRepository(db)
      const memory = createMirroredMemory({
        window: createMemoryWindow({
          windowSize: config.ai.memory.windowSize,
          ttlMinutes: config.ai.memory.ttlMinutes,
        }),
        repo: conversationRepo,
        log,
      })
      const aiModule = createAiModule({
        llm, memory, log, config: config.ai,
        fallbackReply: config.safety.fallbackReply,
        usageRepo: new UsageRepository(db),
      })

      const sender: SafeSender = {
        send: async () => true,
        sendImage: async () => {},
        sendFileBox: async () => {},
      }
      await aiModule.chat('c1', '你好', sender)

      const row = db.prepare('SELECT provider, ok, total_tokens FROM usage_logs').get() as any
      expect(row).toBeDefined()
      // usage 行记录的 provider 来自 loadConfig（可能被 .env 覆盖），
      // 与 mock adapter 无关——只校验它是合法 provider 名。
      expect(typeof row.provider).toBe('string')
      expect(PROVIDER_NAMES).toContain(row.provider)
      expect(row.ok).toBe(1)
      expect(typeof row.total_tokens).toBe('number')
      db.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // 结构性守卫：index.ts 必须真的把 usageRepo 接进 aiModule。
  // 上面的集成用例验证「这样接线是可行的」，本条验证「index.ts 确实这样接了」——
  // 两者缺一不可（只测形状不测装配，正是 C1 能漏进终审的原因）。
  test('index.ts 的 createAiModule 调用必须传入 usageRepo', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url).pathname, 'utf-8')
    expect(src).toMatch(/createAiModule\(\{[\s\S]*?usageRepo:\s*new UsageRepository\(db\)/)
  })
})
