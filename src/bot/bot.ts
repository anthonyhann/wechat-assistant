import { WechatyBuilder } from 'wechaty'
import type { WechatyInterface } from 'wechaty/impls'
import { PuppetMock } from 'wechaty-puppet-mock'
import type { AppConfig } from '../config/config-loader.js'
import type { Logger } from '../utils/logger.js'

export interface BotHandle {
  wechaty: WechatyInterface
  start (): Promise<void>
  stop (): Promise<void>
}

export interface CreateBotOptions {
  config: AppConfig
  log: Logger
  onMessage: (msg: any) => void
}

/**
 * 组装 Wechaty 实例。
 * 协议由环境变量 WECHATY_PUPPET 决定，缺省用 mock（不依赖真号）。
 */
export function createBot (options: CreateBotOptions): BotHandle {
  const { config, log, onMessage } = options

  const puppetName = process.env['WECHATY_PUPPET'] || 'wechaty-puppet-mock'

  const puppet = puppetName === 'wechaty-puppet-mock'
    ? new PuppetMock()
    : undefined

  const wechaty = WechatyBuilder.build({
    name: config.bot.name,
    ...(puppet ? { puppet } : {}),
  })

  wechaty
    .on('scan', (qrcode, status) => {
      log.info('scan: %s (status=%s)', qrcode.slice(0, 40), status)
    })
    .on('login', (user) => {
      log.info('login: %s', user.name())
    })
    .on('logout', (user) => {
      log.warn('logout: %s', user.name())
    })
    .on('error', (e) => {
      log.error('wechaty error: %s', e.message)
    })
    .on('message', (msg) => {
      void (async () => {
        try {
          await onMessage(msg)
        } catch (e) {
          log.error('消息处理异常: %s', (e as Error).message)
        }
      })()
    })

  return {
    wechaty,
    async start () {
      log.info('正在启动机器人（协议: %s）...', puppetName)
      await wechaty.start()
      log.info('机器人已启动')
    },
    async stop () {
      log.info('正在停止机器人...')
      await wechaty.stop()
      log.info('机器人已停止')
    },
  }
}
