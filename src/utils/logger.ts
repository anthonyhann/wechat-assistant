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

  streams.push({
    level: 'warn',
    stream: pino.destination({ dest: join(ensureLogDir(), 'app.log'), mkdir: true, sync: false }),
  })

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
