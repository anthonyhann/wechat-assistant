#!/usr/bin/env node
/**
 * 白名单 seed 脚本。
 * 用法: npm run seed:whitelist -- <roomId> [roomName]
 * 或批量: npm run seed:whitelist -- --file rooms.txt  （每行 roomId[,roomName]）
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDatabase, WhitelistRepository } from '../src/storage/db.js'

const dbPath = process.env['DB_PATH'] || join(process.cwd(), 'data', 'wechat-assistant.sqlite')
const db = createDatabase(dbPath)
const repo = new WhitelistRepository(db)

const args = process.argv.slice(2)

if (args[0] === '--file') {
  const file = args[1]
  if (!file) {
    console.error('用法: npm run seed:whitelist -- --file <path>')
    process.exit(1)
  }
  const lines = readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  for (const line of lines) {
    const [roomId, roomName] = line.split(',').map(s => s.trim())
    if (roomId) repo.add(roomId, roomName || null)
  }
  console.info(`已导入 ${lines.length} 个白名单群`)
} else if (args[0]) {
  const [roomId, roomName] = [args[0], args[1] ?? null]
  repo.add(roomId, roomName)
  console.info(`已加入白名单: ${roomId}${roomName ? ` (${roomName})` : ''}`)
} else {
  const list = repo.list()
  console.info(`当前白名单（${list.length} 个）:`)
  for (const r of list) console.info(`  ${r.room_id}  ${r.room_name ?? ''}  enabled=${r.enabled}`)
}

db.close()
