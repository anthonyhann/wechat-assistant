import { FileBox } from 'file-box'
import type { SafetyGate } from './safety-gate.js'
import type { Logger } from '../utils/logger.js'

/**
 * 唯一允许对外发送内容的通道。
 *
 * 存在理由：安全闸门要求「所有出口必经」，但此前这条约束只靠约定維持——
 * 谁拿到 `msg` 就能直接 `msg.say(...)`，绕过闸门且没有任何测试能发现。
 * 新接入方（流程引擎、AI 模块、阶段 4 看板推送）**只应该拿到本对象**，拿不到 `msg`。
 *
 * 收口的三类出口：
 *  - `send(text)`     文本，必经 checkOutbound，命中即换成兜底话术（L3）
 *  - `sendImage(path)` 本地图片，包成 FileBox（直接传字符串会被 wechaty 当文字发出）
 *  - `sendFileBox(box)` 任意 FileBox，调用方自证内容安全
 */
export interface SafeSender {
  /** 发送文本（经安全闸门）。返回 false 表示原文被拦截、实际发出的是兜底话术 */
  send (text: string): Promise<boolean>
  /** 发送本地图片文件 */
  sendImage (filePath: string): Promise<void>
  /** 发送已构造好的 FileBox（内容安全由调用方负责） */
  sendFileBox (fileBox: FileBox): Promise<void>
}

export interface SafeSenderDeps {
  /** wechaty 消息对象，或任何带 say(any) 的目标 */
  target: { say: (s: any) => Promise<unknown> }
  safetyGate: SafetyGate
  log: Logger
  /** 会话 ID，用于安全审计日志归属 */
  conversationId: string
}

export function createSafeSender (deps: SafeSenderDeps): SafeSender {
  const { target, safetyGate, log, conversationId } = deps

  return {
    async send (text: string): Promise<boolean> {
      const verdict = safetyGate.checkOutbound(text, conversationId)
      if (!verdict.safe) {
        log.warn('出站内容被拦截，改发兜底话术 conv=%s reason=%s', conversationId, verdict.reason)
      }
      await target.say(verdict.text)
      return verdict.safe
    },

    async sendImage (filePath: string): Promise<void> {
      // FileBox.fromFile 会同步 stat 文件，构造期抛错即被调用方捕获
      await target.say(FileBox.fromFile(filePath))
    },

    async sendFileBox (fileBox: FileBox): Promise<void> {
      await target.say(fileBox)
    },
  }
}
