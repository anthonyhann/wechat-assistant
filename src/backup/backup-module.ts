import { existsSync, unlinkSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import type { MediaFileRepository, WhitelistRepository } from '../storage/db.js'
import type { Logger } from '../utils/logger.js'
import type { AppConfig } from '../config/config-loader.js'
import { ensureDir, fileSizeBytes, pickExtension, resolveMediaPath, sha256File } from '../utils/file-utils.js'

export type BackupOutcome = { handled: boolean; reason: string }

export interface BackupModule {
  handle (msg: any): Promise<BackupOutcome>
}

export interface BackupDeps {
  mediaRepo: MediaFileRepository
  whitelistRepo: WhitelistRepository
  log: Logger
  config: AppConfig
  dataDir: string
}

const MEDIA_TYPE_NAMES: Record<number, string> = { 6: 'Image', 8: 'Attachment' }

/**
 * 取错误信息。不假设 throw 的是 Error——puppet 层可能抛出字符串，
 * 直接读 `.message` 会得到 undefined 而丢掉诊断信息。
 */
function errMsg (e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * 消息备份模块（阶段 1）。
 * 只处理白名单群内的图片/文件消息；不产生任何对外回复，因此不经安全闸门。
 */
export function createBackupModule (deps: BackupDeps): BackupModule {
  const { mediaRepo, whitelistRepo, log, config, dataDir } = deps

  return {
    async handle (msg: any): Promise<BackupOutcome> {
      try {
        if (!config.backup.enabled) return { handled: false, reason: 'disabled' }

        const room = msg.room()
        if (!room) return { handled: false, reason: 'not_room' }

        if (!whitelistRepo.isEnabled(room.id)) {
          log.verbose('群 %s 不在白名单，跳过备份', room.id)
          return { handled: false, reason: 'not_whitelisted' }
        }

        const typeName = MEDIA_TYPE_NAMES[msg.type() as number]
        if (!typeName || !config.backup.mediaTypes.includes(typeName as 'Image' | 'Attachment')) {
          return { handled: false, reason: 'not_media' }
        }

        const talker = msg.talker()
        let fileBox: any
        try {
          fileBox = await msg.toFileBox()
        } catch (e) {
          log.error('获取 FileBox 失败 msg=%s: %s', msg.id, errMsg(e))
          return { handled: false, reason: 'error' }
        }

        // 下载前估体积（能估到就估）
        const maxBytes = config.backup.maxFileSizeMB * 1024 * 1024
        const estimated = typeof fileBox.size === 'number' && fileBox.size > 0 ? fileBox.size : null
        if (estimated !== null && estimated > maxBytes) {
          log.warn('文件超限跳过 msg=%s size=%s', msg.id, estimated)
          return { handled: false, reason: 'too_large' }
        }

        const ext = pickExtension({ fileName: fileBox.name ?? null, mime: fileBox.mediaType ?? null })
        const targetPath = resolveMediaPath({
          dataDir, roomId: room.id, date: new Date(), msgId: msg.id, ext,
          timeZone: config.backup.timeZone,
        })
        ensureDir(dirname(targetPath))

        try {
          await fileBox.toFile(targetPath, true)
        } catch (e) {
          log.error('媒体落盘失败 msg=%s: %s', msg.id, errMsg(e))
          // 清理可能写了一半的残留文件（无 DB 记录引用它）
          if (existsSync(targetPath)) {
            try { unlinkSync(targetPath) } catch { /* 清理失败不影响主流程 */ }
          }
          return { handled: false, reason: 'error' }
        }

        // 落盘后复核体积（下载前估不到的情形）
        const actualSize = fileSizeBytes(targetPath)
        if (actualSize > maxBytes) {
          unlinkSync(targetPath)
          log.warn('文件落盘后复核超限已删除 msg=%s size=%s', msg.id, actualSize)
          return { handled: false, reason: 'too_large' }
        }

        const sha256 = await sha256File(targetPath)

        // 去重：同哈希已存在则删掉刚落的重复文件，复用已有路径
        if (config.backup.dedupeByHash) {
          const existing = mediaRepo.findBySha256(sha256)
          if (existing) {
            if (existsSync(targetPath)) unlinkSync(targetPath)
            mediaRepo.insert({
              message_id: msg.id,
              room_id: room.id,
              talker_id: talker.id,
              media_type: typeName === 'Image' ? 'image' : 'attachment',
              mime: fileBox.mediaType ?? null,
              file_name: fileBox.name ?? `${msg.id}${ext}`,
              file_path: existing.file_path,
              file_size: actualSize,
              sha256,
              created_at: Date.now(),
            })
            log.verbose('去重命中 msg=%s sha256=%s', msg.id, sha256.slice(0, 12))
            return { handled: true, reason: 'deduped' }
          }
        }

        // 用 path.relative 而非 startsWith：避免 dataDir='/x/com' 与 '/x/comdata' 的前缀误判
        const relPath = relative(dataDir, targetPath)

        mediaRepo.insert({
          message_id: msg.id,
          room_id: room.id,
          talker_id: talker.id,
          media_type: typeName === 'Image' ? 'image' : 'attachment',
          mime: fileBox.mediaType ?? null,
          file_name: fileBox.name ?? `${msg.id}${ext}`,
          file_path: relPath,
          file_size: actualSize,
          sha256,
          created_at: Date.now(),
        })

        log.info('已备份媒体 msg=%s 类型=%s 路径=%s 大小=%s', msg.id, typeName, relPath, actualSize)
        return { handled: true, reason: 'backed_up' }
      } catch (e) {
        // 兜底：任何未预期错误都不能中断消息处理主流程
        log.error('备份处理异常 msg=%s: %s', msg?.id, errMsg(e))
        return { handled: false, reason: 'error' }
      }
    },
  }
}
