import type { FlowConfig } from '../config/config-loader.js'
import type { Logger } from '../utils/logger.js'
import type { SafeSender } from '../safety/safe-sender.js'

export interface FlowContext {
  conversationId: string
  conversationType: 'contact' | 'room'
  isRoom: boolean
  /** 唯一对外发送通道（内含安全闸门，本引擎不再自行调用闸门） */
  sender: SafeSender
}

export type FlowRunResult = { executed: boolean; reason: string; stepsRun: number }

export interface FlowEngine {
  run (flow: FlowConfig, ctx: FlowContext): Promise<FlowRunResult>
}

export interface FlowEngineDeps {
  log: Logger
  /** 群内同流程冷却秒数；0 或负数表示不冷却 */
  cooldownSeconds?: number
}

const DEFAULT_COOLDOWN_SECONDS = 60
const HANDOFF_REPLY = '已为您转接人工客服，请稍候'

/** 编译正则；非法正则视为永不匹配（不让一条坏配置拖垮整个引擎） */
function compileTrigger (trigger: string): RegExp | null {
  try {
    return new RegExp(trigger)
  } catch {
    return null
  }
}

/**
 * 找到第一条可用的流程。
 * 按 flows 数组顺序，跳过 disabled 与 scope 不符的；命中即返回（不继续找）。
 */
export function matchFlow (flows: FlowConfig[], text: string, scope: 'contact' | 'room'): FlowConfig | null {
  for (const flow of flows) {
    if (!flow.enabled) continue
    if (flow.scope !== 'both' && flow.scope !== scope) continue

    const re = compileTrigger(flow.trigger)
    if (!re) continue
    if (re.test(text)) return flow
  }
  return null
}

/**
 * 关键词流程引擎（阶段 2）。
 *
 * **本引擎不直接发消息，也不自行调用安全闸门** —— 所有出口统一走 `ctx.sender`，
 * 闸门逻辑收口在 `SafeSender` 内。这样任何调用方只要拿到了 engine 就必须先有
 * sender，从结构上消灭「绕过闸门的 msg.say」。
 */
export function createFlowEngine (deps: FlowEngineDeps): FlowEngine {
  const { log } = deps
  const cooldownSeconds = deps.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS
  /** key = `${conversationId}:${flowName}` → 上次触发时间戳(ms) */
  const lastRunAt = new Map<string, number>()

  return {
    async run (flow, ctx): Promise<FlowRunResult> {
      // 冷却检查（群维度；私聊不冷却）
      const cooldownKey = `${ctx.conversationId}:${flow.name}`
      if (cooldownSeconds > 0 && ctx.isRoom) {
        const last = lastRunAt.get(cooldownKey)
        const now = Date.now()
        if (last !== undefined && now - last < cooldownSeconds * 1000) {
          log.verbose('流程冷却中，跳过 %s @ %s', flow.name, ctx.conversationId)
          return { executed: false, reason: 'cooldown', stepsRun: 0 }
        }
        // 注意：这里**不预占**冷却窗口。窗口只在真正发出至少一条消息后才写入，
        // 否则一次瞬时发送失败会让用户「既没收到回复、60s 内再问也不回」。
      }

      let stepsRun = 0
      let skipped = 0

      try {
        for (const step of flow.steps) {
          switch (step.type) {
            case 'say': {
              await ctx.sender.send(step.content)
              break
            }

            case 'handoff': {
              await ctx.sender.send(HANDOFF_REPLY)
              log.info('转人工 handoff channel=%s conv=%s', step.channel, ctx.conversationId)
              break
            }

            case 'image': {
              // 图片来自配置路径，非用户输入，不经文本闸门
              await ctx.sender.sendImage(step.path)
              break
            }

            case 'http': {
              // 阶段 2 不实现：外部调用需要超时/重试/错误策略，属独立工作量。
              // 显式记录并继续，不静默吞掉配置意图。
              log.warn('http 动作尚未实现，已跳过 url=%s（流程 %s）', step.url, flow.name)
              skipped++
              continue
            }
          }
          stepsRun++
        }

        // 全部步骤都被跳过（如流程只配了 http）→ 实际什么都没发生。
        // 不能报成功：否则 router 会写 handled_by='flow'，而用户根本没收到任何消息。
        if (stepsRun === 0 && skipped > 0) {
          log.warn('流程 %s 无任何可执行步骤（%d 个被跳过），不视为已处理', flow.name, skipped)
          return { executed: false, reason: 'no_executable_steps', stepsRun: 0 }
        }

        // 只有真正执行过步骤才占用冷却窗口（失败路径不占用，允许立即重试）
        if (cooldownSeconds > 0 && ctx.isRoom && stepsRun > 0) {
          lastRunAt.set(cooldownKey, Date.now())
        }

        return { executed: true, reason: 'ok', stepsRun }
      } catch (e) {
        log.error('流程执行失败 %s: %s', flow.name, (e as Error).message)
        return { executed: false, reason: 'error', stepsRun }
      }
    },
  }
}
