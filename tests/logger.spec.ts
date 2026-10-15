import { describe, expect, test, vi } from 'vitest'
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
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('MyComp')
    log.info('hello')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
