import { describe, expect, test, vi } from 'vitest'
import { createFlowEngine, matchFlow } from '../src/flow/flow-engine.js'
import { createLogger } from '../src/utils/logger.js'
import type { FlowConfig } from '../src/config/config-loader.js'
import type { SafetyGate } from '../src/safety/safety-gate.js'

const FLOWS: FlowConfig[] = [
  { name: '活动咨询', trigger: '活动|优惠|怎么参加', scope: 'both', enabled: true, steps: [
    { type: 'say', content: '本周活动：老带新各得 20 元券～' },
    { type: 'say', content: '回复「报名」即可登记' },
  ] },
  { name: '转人工', trigger: '人工|客服|投诉', scope: 'both', enabled: true, steps: [
    { type: 'say', content: '已为您转接人工客服，请稍候' },
    { type: 'handoff', channel: 'wecom' },
  ] },
  { name: '禁用流程', trigger: '禁用词', scope: 'both', enabled: false, steps: [{ type: 'say', content: 'x' }] },
  { name: '仅私聊', trigger: '私聊专用', scope: 'contact', enabled: true, steps: [{ type: 'say', content: 'p' }] },
  { name: '仅群聊', trigger: '群专用', scope: 'room', enabled: true, steps: [{ type: 'say', content: 'r' }] },
]

/**
 * 假 SafeSender：记录被发送的内容。
 * 流程引擎不再自行调用闸门 —— 闸门收口在真 SafeSender 内，此处只需 stub 发送行为。
 */
function makeCtx (over: Partial<any> = {}) {
  const replies: string[] = []
  const images: string[] = []
  const files: unknown[] = []
  const sender = {
    send: async (t: string) => { replies.push(t); return true },
    sendImage: async (p: string) => { images.push(p) },
    sendFileBox: async (b: unknown) => { files.push(b) },
  }
  return {
    replies, images, files, sender,
    ctx: {
      conversationId: 'room-1', conversationType: 'room' as const, isRoom: true,
      sender,
      ...over,
    },
  }
}

describe('matchFlow', () => {
  test('命中返回流程', () => {
    expect(matchFlow(FLOWS, '有活动吗', 'room')!.name).toBe('活动咨询')
  })

  test('只返回第一条命中（多条同时命中时）', () => {
    const both: FlowConfig[] = [
      { name: 'A', trigger: 'x', scope: 'both', enabled: true, steps: [{ type: 'say', content: 'a' }] },
      { name: 'B', trigger: 'x', scope: 'both', enabled: true, steps: [{ type: 'say', content: 'b' }] },
    ]
    expect(matchFlow(both, 'x', 'room')!.name).toBe('A')
  })

  test('disabled 流程不匹配', () => {
    expect(matchFlow(FLOWS, '禁用词', 'room')).toBeNull()
  })

  test('scope 过滤：仅私聊的流程在群里不匹配', () => {
    expect(matchFlow(FLOWS, '私聊专用', 'room')).toBeNull()
    expect(matchFlow(FLOWS, '私聊专用', 'contact')!.name).toBe('仅私聊')
  })

  test('scope=both 两个场景都匹配', () => {
    expect(matchFlow(FLOWS, '活动', 'room')!.name).toBe('活动咨询')
    expect(matchFlow(FLOWS, '活动', 'contact')!.name).toBe('活动咨询')
  })

  test('未命中返回 null', () => {
    expect(matchFlow(FLOWS, '今天天气', 'room')).toBeNull()
  })

  test('非法正则不抛错，视为不匹配', () => {
    const bad: FlowConfig[] = [
      { name: 'X', trigger: '([', scope: 'both', enabled: true, steps: [{ type: 'say', content: 'x' }] },
    ]
    expect(() => matchFlow(bad, 'anything', 'room')).not.toThrow()
    expect(matchFlow(bad, 'anything', 'room')).toBeNull()
  })
})

describe('flowEngine.run', () => {
  const engine = () => createFlowEngine({ log: createLogger('FlowTest') })

  test('say 步骤按顺序发出', async () => {
    const { ctx, replies } = makeCtx()
    const r = await engine().run(FLOWS[0]!, ctx)
    expect(r).toEqual({ executed: true, reason: 'ok', stepsRun: 2 })
    expect(replies).toEqual(['本周活动：老带新各得 20 元券～', '回复「报名」即可登记'])
  })

  test('handoff 步骤发出转接话术', async () => {
    const { ctx, replies } = makeCtx({ conversationId: 'room-2' })
    const r = await engine().run(FLOWS[1]!, ctx)
    expect(r.executed).toBe(true)
    expect(replies.some(t => t.includes('转接'))).toBe(true)
  })

  // 引擎职责边界：它把配置文本原样交给 sender，**不自行判定拦截**。
  // 拦截与兜底由 SafeSender 负责（见 tests/safe-sender.spec.ts）。
  test('say 步骤把配置文本交给 sender（不自行改内容）', async () => {
    const { ctx, replies } = makeCtx()
    await engine().run(FLOWS[0]!, ctx)
    expect(replies).toEqual(['本周活动：老带新各得 20 元券～', '回复「报名」即可登记'])
  })

  test('冷却：同群同流程第二次被拒', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    const first = makeCtx()
    const second = makeCtx()
    expect((await eng.run(FLOWS[0]!, first.ctx)).executed).toBe(true)
    const r2 = await eng.run(FLOWS[0]!, second.ctx)
    expect(r2).toEqual({ executed: false, reason: 'cooldown', stepsRun: 0 })
    expect(second.replies).toEqual([])
  })

  test('冷却按「群+流程」隔离：同群不同流程不受影响', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    await eng.run(FLOWS[0]!, makeCtx().ctx)
    const other = makeCtx()
    expect((await eng.run(FLOWS[1]!, other.ctx)).executed).toBe(true)
  })

  test('冷却按群隔离：不同群互不影响', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    await eng.run(FLOWS[0]!, makeCtx({ conversationId: 'room-A' }).ctx)
    const otherRoom = makeCtx({ conversationId: 'room-B' })
    expect((await eng.run(FLOWS[0]!, otherRoom.ctx)).executed).toBe(true)
  })

  test('私聊不施加冷却', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    const c1 = makeCtx({ conversationType: 'contact', isRoom: false, conversationId: 'user-1' })
    const c2 = makeCtx({ conversationType: 'contact', isRoom: false, conversationId: 'user-1' })
    expect((await eng.run(FLOWS[0]!, c1.ctx)).executed).toBe(true)
    expect((await eng.run(FLOWS[0]!, c2.ctx)).executed).toBe(true)
  })

  test('http 步骤本阶段跳过但不中断后续步骤', async () => {
    const withHttp: FlowConfig = {
      name: 'http流程', trigger: 'h', scope: 'both', enabled: true, steps: [
        { type: 'http', url: 'https://example.com', method: 'GET' },
        { type: 'say', content: '后续步骤' },
      ],
    }
    const { ctx, replies } = makeCtx()
    const r = await engine().run(withHttp, ctx)
    expect(r.executed).toBe(true)
    expect(replies).toEqual(['后续步骤'])
  })

  // 回归：失败不应占用冷却窗口。
  // 否则一次瞬时发送失败会让用户「既没收到回复、60s 内再问也不回」。
  test('执行失败不占用冷却窗口（可立即重试）', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    const failCtx = makeCtx({ sender: { send: async () => { throw new Error('send failed') }, sendImage: async () => {}, sendFileBox: async () => {} } })
    const r1 = await eng.run(FLOWS[0]!, failCtx.ctx)
    expect(r1.executed).toBe(false)
    expect(r1.reason).toBe('error')

    // 立即重试：应正常执行，而非被冷却挡下
    const okCtx = makeCtx()
    const r2 = await eng.run(FLOWS[0]!, okCtx.ctx)
    expect(r2.executed).toBe(true)
    expect(okCtx.replies).toHaveLength(2)
  })

  test('成功执行后才占用冷却窗口', async () => {
    const eng = createFlowEngine({ log: createLogger('FlowTest'), cooldownSeconds: 60 })
    const first = makeCtx()
    expect((await eng.run(FLOWS[0]!, first.ctx)).executed).toBe(true)
    const second = makeCtx()
    expect((await eng.run(FLOWS[0]!, second.ctx)).reason).toBe('cooldown')
  })

  // 回归：全部步骤都被跳过时不能报成功。
  // 否则 router 会写 handled_by='flow'，而用户根本没收到任何消息（假成功）。
  test('全部步骤被跳过时返回 no_executable_steps 而非成功', async () => {
    const allHttp: FlowConfig = {
      name: '纯http流程', trigger: 'hx', scope: 'both', enabled: true,
      steps: [{ type: 'http', url: 'https://example.com', method: 'GET' }],
    }
    const { ctx, replies } = makeCtx()
    const r = await engine().run(allHttp, ctx)
    expect(r.executed).toBe(false)
    expect(r.reason).toBe('no_executable_steps')
    expect(r.stepsRun).toBe(0)
    expect(replies).toEqual([])
  })

  test('reply 抛错时停止执行并返回 error', async () => {
    const failing = makeCtx({ sender: { send: async () => { throw new Error('send failed') }, sendImage: async () => {}, sendFileBox: async () => {} } })
    const r = await engine().run(FLOWS[0]!, failing.ctx)
    expect(r.executed).toBe(false)
    expect(r.reason).toBe('error')
  })

  test('image 步骤调用 sayImage', async () => {
    const withImage: FlowConfig = {
      name: '图', trigger: 'i', scope: 'both', enabled: true, steps: [{ type: 'image', path: '/tmp/a.png' }],
    }
    const { ctx, images } = makeCtx()
    await engine().run(withImage, ctx)
    expect(images).toEqual(['/tmp/a.png'])
  })
})
