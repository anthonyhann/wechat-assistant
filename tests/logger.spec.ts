import { describe, expect, test, vi } from 'vitest'
// 注意：pino-pretty 经 sonic-boom 写 fd 1（process.stdout），但它走的是 fs.write(fd, buf, cb)
// 而非 process.stdout.write，因此 spy process.stdout.write / console.info 都收不到调用。
// 断言日志输出必须 spy 真正的写出口：node:fs 的 write（fd === 1）。
import fs from 'node:fs'
import { createLogger, setLogLevel } from '../src/utils/logger.js'

describe('logger', () => {
  test('createLogger 返回含六个级别方法的对象', () => {
    const log = createLogger('Test')
    for (const level of ['error', 'warn', 'info', 'debug', 'trace'] as const) {
      expect(typeof log[level]).toBe('function')
    }
    // wechaty 风格别名
    expect(typeof log.verbose).toBe('function')
    expect(typeof log.silly).toBe('function')
  })

  test('setLogLevel 可切换级别不抛错', () => {
    expect(() => setLogLevel('debug')).not.toThrow()
  })

  test('记录日志时输出组件名', () => {
    const written: string[] = []
    const original = fs.write.bind(fs)
    const spy = vi.spyOn(fs, 'write').mockImplementation(((...args: any[]) => {
      // sonic-boom 对 stdout 的写出口是 fd 1
      if (args[0] === 1) written.push(String(args[1]))
      return (original as (...a: any[]) => any)(...args)
    }) as never)
    const log = createLogger('MyComp')
    log.info('hello')
    spy.mockRestore()
    const output = written.join('')
    expect(output).toContain('MyComp')
    expect(output).toContain('hello')
  })
})
