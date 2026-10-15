import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import type { Server } from 'node:http'
import type Database from 'better-sqlite3'
import type { AppConfig } from '../config/config-loader.js'
import type { Logger } from '../utils/logger.js'
import { MessageRepository, WhitelistRepository, SafetyLogRepository, UsageRepository, MediaFileRepository } from '../storage/db.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AdminServerDeps {
  db: Database.Database
  config: AppConfig
  log: Logger
  reloadFlows: () => void
}

export interface AdminServer {
  start (): Promise<void>
  stop (): Promise<void>
  readonly port: number
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>微信社群个人助理</title>
<style>body{font-family:system-ui;max-width:1200px;margin:0 auto;padding:20px;background:#f5f5f5}
h1{color:#333}table{border-collapse:collapse;width:100%;background:#fff;margin:12px 0}
th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px}
th{background:#f0f0f0}.card{background:#fff;padding:16px;margin:12px 0;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.stat{font-size:28px;font-weight:bold;color:#2563eb}.label{color:#666;font-size:13px}
input,button{padding:6px 10px;font-size:14px}button{cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:4px}
button:hover{background:#1d4ed8}.ok{color:#059669}.err{color:#dc2626}</style>
</head><body>
<h1>🤖 微信社群个人助理</h1>
<div class="cards" id="stats"></div>
<div class="card"><h2>最近消息</h2><div id="messages"></div></div>
<div class="card"><h2>白名单群</h2><div id="whitelist"></div>
<input id="wlId" placeholder="roomId"><input id="wlName" placeholder="群名">
<button onclick="addWhitelist()">添加</button></div>
<div class="card"><h2>关键词流程</h2><div id="flows"></div></div>
<div class="card"><h2>安全拦截日志</h2><div id="safety"></div></div>
<div class="card"><h2>LLM 用量</h2><div id="usage"></div></div>
<script>
const B=''
async function load(){
  const s=await(await fetch(B+'/api/stats')).json()
  document.getElementById('stats').innerHTML=
    ['todayMessages','backupFiles','backupSizeMB','aiCalls','safetyBlocks'].map(k=>
      \`<div class="card"><div class="stat">\${s[k]??'-'}</div><div class="label">\${k}</div></div>\`).join('')+
    \`<div class="card"><div class="stat">\${s.usage?.totalTokens??0}</div><div class="label">今日 tokens</div></div>\`
  const msgs=await(await fetch(B+'/api/messages?limit=50')).json()
  document.getElementById('messages').innerHTML='<table><tr><th>时间</th><th>会话</th><th>类型</th><th>内容</th><th>处理</th><th>安全</th></tr>'+
    msgs.map(m=>\`<tr><td>\${new Date(m.created_at).toLocaleTimeString()}</td><td>\${m.conversation_id}</td><td>\${m.msg_type}</td><td>\${(m.text||'').slice(0,50)}</td><td>\${m.handled_by||''}</td><td class="\${m.safety_result?'err':'ok'}">\${m.safety_result||'-'}</td></tr>\`).join('')+'</table>'
  const wl=await(await fetch(B+'/api/whitelist')).json()
  document.getElementById('whitelist').innerHTML='<table><tr><th>roomId</th><th>群名</th><th>操作</th></tr>'+
    wl.map(w=>\`<tr><td>\${w.room_id}</td><td>\${w.room_name||''}</td><td><button onclick="delWhitelist('\${w.room_id}')">移除</button></td></tr>\`).join('')+'</table>'
  const fl=await(await fetch(B+'/api/flows')).json()
  document.getElementById('flows').innerHTML='<table><tr><th>名称</th><th>触发词</th><th>范围</th><th>启用</th></tr>'+
    fl.map(f=>\`<tr><td>\${f.name}</td><td>\${f.trigger}</td><td>\${f.scope}</td><td>\${f.enabled?'✅':'❌'}</td></tr>\`).join('')+'</table>'
  const sf=await(await fetch(B+'/api/safety-logs?limit=20')).json()
  document.getElementById('safety').innerHTML='<table><tr><th>时间</th><th>方向</th><th>层</th><th>命中词</th><th>片段</th></tr>'+
    sf.map(l=>\`<tr><td>\${new Date(l.created_at).toLocaleTimeString()}</td><td>\${l.direction}</td><td>\${l.layer}</td><td>\${l.matched_word||''}</td><td>\${(l.snippet||'').slice(0,40)}</td></tr>\`).join('')+'</table>'
  const us=await(await fetch(B+'/api/usage?days=7')).json()
  document.getElementById('usage').innerHTML='<table><tr><th>日期</th><th>调用数</th><th>tokens</th></tr>'+
    us.map(u=>\`<tr><td>\${u.day}</td><td>\${u.calls}</td><td>\${u.totalTokens}</td></tr>\`).join('')+'</table>'
}
async function addWhitelist(){const roomId=document.getElementById('wlId').value.trim();if(!roomId)return
  await fetch(B+'/api/whitelist',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,roomName:document.getElementById('wlName').value.trim()||null})})
  load()}
async function delWhitelist(roomId){await fetch(B+'/api/whitelist',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,enabled:false})});load()}
load();setInterval(load,30000)
</script></body></html>`

export function createAdminServer (deps: AdminServerDeps): AdminServer {
  const { db, config, log, reloadFlows } = deps
  const app: Express = express()
  app.use(express.json())

  const msgRepo = new MessageRepository(db)
  const whitelistRepo = new WhitelistRepository(db)
  const safetyRepo = new SafetyLogRepository(db)
  const usageRepo = new UsageRepository(db)
  const mediaRepo = new MediaFileRepository(db)

  // 鉴权中间件：token 为空串时仅本地回环（本就只绑 127.0.0.1）
  app.use((req: Request, res: Response, next: NextFunction) => {
    const token = config.bot.adminServer.token
    if (!token) return next()
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing authorization' })
      return
    }
    if (auth.slice(7) !== token) {
      res.status(403).json({ error: 'invalid token' })
      return
    }
    next()
  })

  // 看板
  app.get('/api/stats', (_req, res) => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayTs = todayStart.getTime()

    const todayMessages = (db.prepare('SELECT COUNT(*) AS c FROM messages WHERE created_at >= ?').get(todayTs) as any).c
    const backupStats = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(file_size),0) AS s FROM media_files').get() as any
    const aiStats = db.prepare("SELECT ai_result, COUNT(*) AS c FROM messages WHERE ai_result IS NOT NULL GROUP BY ai_result").all() as any[]
    const safetyBlocks = safetyRepo.countAll()
    const usage = usageRepo.todayStats()

    res.json({
      todayMessages,
      backupFiles: backupStats.c,
      backupSizeMB: Math.round(backupStats.s / 1024 / 1024 * 100) / 100,
      aiCalls: aiStats.reduce((sum, r) => sum + r.c, 0),
      aiByResult: Object.fromEntries(aiStats.map(r => [r.ai_result, r.c])),
      safetyBlocks,
      usage,
    })
  })

  app.get('/api/messages', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const rows = msgRepo.recent(limit)
    res.json(rows)
  })

  app.get('/api/media', (req, res) => {
    const roomId = req.query.roomId as string | undefined
    const rows = roomId
      ? db.prepare('SELECT * FROM media_files WHERE room_id = ? ORDER BY created_at DESC LIMIT 100').all(roomId)
      : db.prepare('SELECT * FROM media_files ORDER BY created_at DESC LIMIT 100').all()
    res.json(rows)
  })

  app.get('/api/safety-logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    res.json(safetyRepo.recent(limit))
  })

  app.get('/api/usage', (req, res) => {
    const days = Math.min(Number(req.query.days) || 7, 30)
    res.json(usageRepo.statsByDay(days))
  })

  // 配置
  app.get('/api/whitelist', (_req, res) => {
    res.json(whitelistRepo.list())
  })

  app.put('/api/whitelist', (req, res) => {
    const { roomId, roomName, enabled } = req.body ?? {}
    if (!roomId || typeof roomId !== 'string') {
      res.status(400).json({ error: 'roomId required' })
      return
    }
    if (enabled === false) {
      whitelistRepo.remove(roomId)
    } else {
      whitelistRepo.add(roomId, roomName ?? null)
    }
    log.info('白名单更新 roomId=%s enabled=%s', roomId, enabled !== false)
    res.json({ ok: true })
  })

  app.get('/api/flows', (_req, res) => {
    res.json(config.flows)
  })

  app.put('/api/flows', (req, res) => {
    const flows = req.body?.flows
    if (!Array.isArray(flows)) {
      res.status(400).json({ error: 'flows array required' })
      return
    }
    // 写回 config/flows.json
    const flowsPath = join(process.cwd(), 'config', 'flows.json')
    writeFileSync(flowsPath, JSON.stringify({ flows }, null, 2) + '\n', 'utf-8')
    // 触发热更新
    reloadFlows()
    log.info('流程配置已更新（%d 条）并热生效', flows.length)
    res.json({ ok: true })
  })

  // 单页看板
  app.get('/', (_req, res) => {
    res.type('html').send(HTML_PAGE)
  })

  let server: Server | null = null
  let boundPort = 0

  return {
    get port () { return boundPort },

    start () {
      return new Promise((resolve, reject) => {
        const port = config.bot.adminServer.port
        server = app.listen(port, '127.0.0.1', () => {
          const addr = server!.address()
          boundPort = typeof addr === 'object' && addr ? addr.port : port
          log.info('管理台已启动 http://127.0.0.1:%d', boundPort)
          resolve()
        })
        server!.on('error', reject)
      })
    },

    stop () {
      return new Promise((resolve) => {
        if (server) {
          server.close(() => resolve())
        } else {
          resolve()
        }
      })
    },
  }
}
