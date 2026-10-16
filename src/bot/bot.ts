import { WechatyBuilder } from 'wechaty'
import type { WechatyInterface } from 'wechaty/impls'
import { PuppetMock } from 'wechaty-puppet-mock'
import qrcode from 'qrcode'
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
    .on('scan', (qrcodeValue, status) => {
      log.info('scan (status=%s): %s', status, qrcodeValue)
      // 在终端画出可扫描的二维码（wechaty 的 scan 值就是登录 URL）
      qrcode.toString(qrcodeValue, { type: 'terminal', small: true }, (err, str) => {
        if (err) {
          log.error('二维码渲染失败，请手动打开上面的链接: %s', qrcodeValue)
          return
        }
        console.info(`\n${str}\n请用微信扫描上方二维码登录\n`)
      })
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
