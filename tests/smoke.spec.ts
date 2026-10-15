import { describe, expect, test } from 'vitest'

describe('工具链冒烟测试', () => {
  test('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2)
  })

  test('ESM import .js 后缀可解析', async () => {
    const mod = await import('../src/index.js')
    expect(mod).toBeDefined()
  })
})
