import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import pretty from 'pino-pretty'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export type Logger = pino.Logger & {
  verbose: pino.LogFn
  silly: pino.LogFn
}

let globalLevel: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info'

function ensureLogDir (): string {
  const dir = join(process.cwd(), 'data', 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 文件 destination 句柄列表。
 *
 * 存在的理由：`process.exit()` 会中断 pino 的异步文件写入（sonic-boom），
 * 不仅尾部日志会丢，pino 注册的 `on-exit` 自动 flush 钩子还会抛
 * "sonic boom is not ready yet" 让进程以非零码退出。
 * 对会主动 `process.exit()` 的进程（联调脚本、bot 的 SIGINT 处理），
 * 文件流必须用 `sync: true` —— 同步写没有缓冲区，退出即安全。
 */
const fileDestinations: Array<{ flushSync?: () => void }> = []

/** 文件日志是否同步写。短生命周期进程设 true，长驻服务可设 false 换取吞吐。 */
const FILE_SYNC = process.env['LOG_FILE_SYNC'] !== 'false'

function buildLogger (name: string): Logger {
  const isPretty = process.env['NODE_ENV'] !== 'production'
  const streams: pino.StreamEntry[] = []

  if (isPretty) {
    streams.push({
      level: globalLevel,
      stream: pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss' }),
    })
  } else {
    streams.push({ level: globalLevel, stream: process.stdout })
  }

  const fileDest = pino.destination({
    dest: join(ensureLogDir(), 'app.log'),
    mkdir: true,
    sync: FILE_SYNC,
  })
  fileDestinations.push(fileDest)
  streams.push({ level: 'warn', stream: fileDest })

  const base = pino(
    { level: globalLevel, name, base: undefined },
    pino.multistream(streams),
  )

  const logger = base as Logger
  logger.verbose = base.debug.bind(base)
  logger.silly = base.trace.bind(base)
  return logger
}

export function createLogger (name: string): Logger {
  return buildLogger(name)
}

export function setLogLevel (level: LogLevel): void {
  globalLevel = level
}

/**
 * 同步 flush 所有文件日志流（尽力而为，失败静默）。
 *
 * 即使文件流已配 `sync: true`（无缓冲区），保留此函数作为双保险；
 * 若未来把 `LOG_FILE_SYNC=false` 换回异步，退出前调用它仍是必要的。
 */
export function flushLogs (): void {
  for (const dest of fileDestinations) {
    try {
      dest.flushSync?.()
    } catch {
      // sonic-boom 未就绪（尚无写入）或已关闭 —— 不应阻断退出
    }
  }
}
