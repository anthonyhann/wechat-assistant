import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256File, fileSizeBytes, resolveMediaPath, pickExtension, ensureDir } from '../src/utils/file-utils.js'

function tempDir () {
  const dir = mkdtempSync(join(tmpdir(), 'wc-fu-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('sha256File', () => {
  test('同样内容得到同样哈希，不同内容不同', async () => {
    const { dir, cleanup } = tempDir()
    try {
      const a = join(dir, 'a.txt'); writeFileSync(a, 'hello')
      const b = join(dir, 'b.txt'); writeFileSync(b, 'hello')
      const c = join(dir, 'c.txt'); writeFileSync(c, 'world')
      expect(await sha256File(a)).toBe(await sha256File(b))
      expect(await sha256File(a)).not.toBe(await sha256File(c))
      expect(await sha256File(a)).toMatch(/^[0-9a-f]{64}$/)
    } finally { cleanup() }
  })
})

describe('fileSizeBytes', () => {
  test('返回字节数', () => {
    const { dir, cleanup } = tempDir()
    try {
      const f = join(dir, 'x.bin'); writeFileSync(f, Buffer.alloc(2048))
      expect(fileSizeBytes(f)).toBe(2048)
    } finally { cleanup() }
  })
})

describe('pickExtension', () => {
  test('优先取原文件名的扩展名', () => {
    expect(pickExtension({ fileName: '报价单.pdf', mime: 'image/jpeg' })).toBe('.pdf')
  })

  test('原文件名无扩展名时按 MIME 映射', () => {
    expect(pickExtension({ fileName: 'noext', mime: 'image/jpeg' })).toBe('.jpg')
    expect(pickExtension({ fileName: null, mime: 'application/pdf' })).toBe('.pdf')
  })

  test('都拿不到时兜底 .bin', () => {
    expect(pickExtension({ fileName: null, mime: null })).toBe('.bin')
    expect(pickExtension({ fileName: 'x', mime: 'application/x-unknown-thing' })).toBe('.bin')
  })

  test('扩展名统一小写', () => {
    expect(pickExtension({ fileName: 'PHOTO.JPG', mime: null })).toBe('.jpg')
  })
})

describe('resolveMediaPath', () => {
  test('按 群/日期/消息ID.ext 组织路径', () => {
    const p = resolveMediaPath({
      dataDir: '/data', roomId: 'room-1', date: new Date('2026-08-13T10:00:00Z'),
      msgId: 'msg-1', ext: '.jpg',
    })
    expect(p).toBe(join('/data', 'media', 'room-1', '2026-08-13', 'msg-1.jpg'))
  })

  test('无群（私聊）时归入 _private 目录', () => {
    const p = resolveMediaPath({
      dataDir: '/data', roomId: null, date: new Date('2026-08-13T10:00:00Z'),
      msgId: 'msg-2', ext: '.pdf',
    })
    expect(p).toBe(join('/data', 'media', '_private', '2026-08-13', 'msg-2.pdf'))
  })

  // 回归测试：北京时间 00:00-07:59 的消息若按 UTC 切片会被归入前一天
  test('按指定时区取日期（Asia/Shanghai 凌晨消息不落到前一天）', () => {
    const early = new Date('2026-08-13T00:30:00+08:00')
    const p = resolveMediaPath({
      dataDir: '/data', roomId: 'room-1', date: early,
      msgId: 'msg-early', ext: '.jpg', timeZone: 'Asia/Shanghai',
    })
    expect(p).toBe(join('/data', 'media', 'room-1', '2026-08-13', 'msg-early.jpg'))
  })

  test('时区参数跨日边界正确（UTC 仍是前一天时）', () => {
    // 北京时间 2026-08-13 00:00 即 UTC 2026-08-12 16:00
    const midnight = new Date('2026-08-13T00:00:00+08:00')
    const shanghai = resolveMediaPath({
      dataDir: '/d', roomId: 'r', date: midnight, msgId: 'm', ext: '.jpg', timeZone: 'Asia/Shanghai',
    })
    const utc = resolveMediaPath({
      dataDir: '/d', roomId: 'r', date: midnight, msgId: 'm', ext: '.jpg', timeZone: 'UTC',
    })
    expect(shanghai).toBe(join('/d', 'media', 'r', '2026-08-13', 'm.jpg'))
    expect(utc).toBe(join('/d', 'media', 'r', '2026-08-12', 'm.jpg'))
  })

  test('不传时区时使用本地时区（非 UTC）', () => {
    // 用本地时区构造一个当天中午的时间点，应稳定落在当天
    const noonLocal = new Date(2026, 7, 13, 12, 0, 0)
    const p = resolveMediaPath({
      dataDir: '/d', roomId: 'r', date: noonLocal, msgId: 'm', ext: '.jpg',
    })
    expect(p).toBe(join('/d', 'media', 'r', '2026-08-13', 'm.jpg'))
  })
})

describe('ensureDir', () => {
  test('创建多级目录且幂等', () => {
    const { dir, cleanup } = tempDir()
    try {
      const target = join(dir, 'a', 'b', 'c')
      ensureDir(target)
      ensureDir(target)
      expect(() => writeFileSync(join(target, 'f.txt'), 'ok')).not.toThrow()
    } finally { cleanup() }
  })
})
