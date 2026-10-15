import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 计算文件 sha256（流式，避免大文件占内存） */
export function sha256File (filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export function fileSizeBytes (filePath: string): number {
  return statSync(filePath).size
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
}

/**
 * 推导落盘扩展名：原文件名扩展名 > MIME 映射 > .bin
 * 结果统一小写并带前导点。
 */
export function pickExtension (opts: { fileName?: string | null; mime?: string | null }): string {
  const { fileName, mime } = opts

  if (fileName) {
    const dot = fileName.lastIndexOf('.')
    if (dot > 0 && dot < fileName.length - 1) {
      const ext = fileName.slice(dot).toLowerCase()
      // 拒绝异常长的"扩展名"（可能是文件名里的点而非真扩展名）
      if (ext.length <= 10 && /^\.[a-z0-9]+$/.test(ext)) {
        return ext
      }
    }
  }

  if (mime) {
    const mapped = MIME_EXT[mime.toLowerCase().split(';')[0]!.trim()]
    if (mapped) return mapped
  }

  return '.bin'
}

/**
 * 按指定时区取 YYYY-MM-DD。
 * 未传 timeZone 时用系统本地时区（而非 UTC）——避免北京时间 00:00-07:59 的消息
 * 被误归入前一天目录。
 */
function localDay (date: Date, timeZone?: string): string {
  // en-CA 的日期格式天然是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** 组织媒体落盘路径：{dataDir}/media/{roomId|_private}/{YYYY-MM-DD}/{msgId}{ext} */
export function resolveMediaPath (opts: {
  dataDir: string
  roomId: string | null
  date: Date
  msgId: string
  ext: string
  /** 可选时区，如 'Asia/Shanghai'；缺省用系统本地时区 */
  timeZone?: string
}): string {
  const { dataDir, roomId, date, msgId, ext, timeZone } = opts
  const day = localDay(date, timeZone)
  const bucket = roomId ?? '_private'
  return join(dataDir, 'media', bucket, day, `${msgId}${ext}`)
}

export function ensureDir (dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}
