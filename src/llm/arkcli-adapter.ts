import { execFile } from 'node:child_process'
import type { LlmAdapter, LlmRequest, LlmResult } from './llm-interface.js'
import type { Logger } from '../utils/logger.js'

export interface ArkcliAdapterOptions {
  model: string
  timeoutMs?: number
  log?: Logger
  /** 可注入的 execFile（测试用，不打真实网络） */
  execFileImpl?: typeof execFile
}

/** arkcli 的 JSON 输出契约（已实测验证） */
interface ArkcliResponse {
  status: string
  content?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  id?: string
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * 火山方舟 Coding Plan 适配器（经 arkcli）。
 *
 * 为什么需要它：Coding Plan 的 key **不能**像标准方舟那样用裸 Bearer 打
 * `/api/v3/chat/completions`（实测 404 / InvalidEndpointOrModel），
 * 必须走 arkcli 的数据面（Responses API）。此适配器把 LlmAdapter 接口
 * 桥接到 `arkcli +chat`。
 *
 * 用法：.env 设 LLM_PROVIDER=arkcli（或 config/ai.json 的 provider），
 * 并确保本机已 `arkcli auth login` 登录。
 */
export function createArkcliAdapter (opts: ArkcliAdapterOptions): LlmAdapter {
  const { model, timeoutMs = DEFAULT_TIMEOUT_MS, log } = opts
  const execFileImpl = opts.execFileImpl ?? execFile

  return {
    name: 'arkcli',
    async complete (req: LlmRequest): Promise<LlmResult> {
      // arkcli +chat 是单轮 CLI（多轮需服务端 store + previous-response-id，
      // 而 Coding Plan 默认不 store）。因此把对话历史序列化进 prompt 文本：
      // 这是 CLI 桥接下唯一可行的多轮方式。
      const systemMsg = req.messages.find(m => m.role === 'system')
      const historyParts: string[] = []
      let lastUser = ''
      for (const m of req.messages) {
        if (m.role === 'system') continue
        if (m.role === 'user') {
          if (lastUser) historyParts.push(`用户：${lastUser}`)
          lastUser = m.content
        } else {
          if (lastUser) {
            historyParts.push(`用户：${lastUser}`)
            lastUser = ''
          }
          historyParts.push(`助理：${m.content}`)
        }
      }

      let prompt = ''
      if (historyParts.length > 0) {
        prompt += `以下是本次对话的先前记录：\n${historyParts.join('\n')}\n\n`
      }
      prompt += lastUser

      const args = [
        '+chat',
        '--model', model,
        '--max-output-tokens', String(req.maxTokens ?? 1024),
        '--thinking', 'disabled',
        '--format', 'json',
      ]
      if (req.temperature !== undefined) {
        args.push('--temperature', String(req.temperature))
      }
      if (systemMsg) {
        args.push('--instructions', systemMsg.content)
      }
      args.push(prompt)

      const result = await new Promise<LlmResult>(resolve => {
        // 剔除 ARK_API_KEY / ARK_BASE_URL：
        // ① 传 key 会让 arkcli 切成「仅凭 API Key」模式，无法验证 Coding Plan 协议签署状态；
        // ② arkcli 会读取环境里的 ARK_BASE_URL 并进入「自定义数据面端点」模式，
        //    该模式强制要求 API key，与登录态互斥。
        // arkcli provider 的路由完全由本机 profile 决定，不需要这两个变量。
        const { ARK_API_KEY: _k, ARK_BASE_URL: _b, ...envForArkcli } = process.env
        execFileImpl(
          'arkcli',
          args,
          {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            env: {
              ...envForArkcli,
              // 关闭更新提示与遥测，保证 stdout 只有 JSON
              ARKCLI_NO_UPDATE_NOTIFIER: '1',
              ARKCLI_CALLER_TYPE: 'ai_agent',
              ARKCLI_CALLER_NAME: 'wechat-assistant',
              ARKCLI_SKILL_NAME: 'arkcli-chat',
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              const msg = error.killed ? `arkcli 超时（${timeoutMs}ms）` : error.message
              log?.warn('arkcli 调用失败 model=%s: %s', model, msg)
              resolve({ ok: false, error: msg, retryable: true })
              return
            }

            try {
              const parsed = JSON.parse(stdout) as ArkcliResponse
              if (parsed.status !== 'completed') {
                resolve({ ok: false, error: `arkcli status=${parsed.status}`, retryable: true })
                return
              }
              const text = parsed.content ?? ''
              if (!text.trim()) {
                resolve({ ok: false, error: 'arkcli 返回空内容', retryable: false })
                return
              }
              const result: LlmResult = { ok: true, text }
              if (parsed.usage && typeof parsed.usage.total_tokens === 'number') {
                result.usage = {
                  promptTokens: parsed.usage.prompt_tokens,
                  completionTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                }
              }
              resolve(result)
            } catch {
              // stdout 不是 JSON —— 多半是 CLI 用法错误（未登录/模型不存在）
              const hint = (stderr || stdout).slice(0, 200)
              log?.warn('arkcli 输出解析失败 model=%s: %s', model, hint)
              resolve({ ok: false, error: `arkcli 输出非 JSON: ${hint}`, retryable: false })
            }
          },
        )
      })

      return result
    },
  }
}
