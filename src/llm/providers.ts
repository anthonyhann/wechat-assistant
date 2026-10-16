/**
 * LLM Provider 注册表。
 *
 * 设计意图：新增一个 LLM 提供方 = 在此文件加一条 preset（或用户在 ai.json 的
 * providers 里加一条），**不需要改任何代码**。工厂按 preset.protocol 分发到
 * 对应适配器。
 *
 * 协议覆盖（截至 2026-10）：
 *   - openai-compat：国内外绝大多数厂商（DeepSeek/Qwen/GLM/Kimi/MiniMax/百川/豆包/OpenAI/…）
 *   - anthropic：    Claude 的 Messages API（x-api-key，独立协议）
 *   - gemini：       Google 的 generateContent API（x-goog-api-key，独立协议）
 *   - arkcli：       火山方舟 Coding Plan（走本机 arkcli CLI）
 *   - mock：         开发用回显
 */

export type LlmProtocol = 'openai-compat' | 'anthropic' | 'gemini' | 'arkcli' | 'mock'

export interface ProviderPreset {
  /** 配置里引用的名字（provider 字段填这个） */
  name: string
  /** 展示名 */
  label: string
  protocol: LlmProtocol
  /** API baseUrl（arkcli/mock 为空） */
  baseUrl: string
  /** 存放 API key 的环境变量名（arkcli/mock 为空） */
  apiKeyEnv: string
  /** 代表性模型（厂商更新快，以官方文档为准；用户可在 ai.json 覆盖） */
  models: string[]
  /** 官方文档 */
  docs?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ============ 国内 ============
  {
    name: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compat',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docs: 'https://api-docs.deepseek.com/',
  },
  {
    name: 'qwen',
    label: '通义千问 (Qwen)',
    protocol: 'openai-compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    docs: 'https://help.aliyun.com/zh/model-studio/',
  },
  {
    name: 'glm',
    label: '智谱 GLM',
    protocol: 'openai-compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    models: ['glm-4-plus', 'glm-4-air'],
    docs: 'https://docs.bigmodel.cn/',
  },
  {
    name: 'kimi',
    label: 'Kimi (月之暗面)',
    protocol: 'openai-compat',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k'],
    docs: 'https://platform.moonshot.cn/docs/',
  },
  {
    name: 'doubao',
    label: '豆包 (火山方舟)',
    protocol: 'openai-compat',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'ARK_API_KEY',
    models: ['doubao-seed-1-6-250615'],
    docs: 'https://www.volcengine.com/docs/82379/',
  },
  {
    name: 'minimax',
    label: 'MiniMax',
    protocol: 'openai-compat',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: ['MiniMax-M2', 'abab6.5s-chat'],
    docs: 'https://platform.minimaxi.com/',
  },
  {
    name: 'baichuan',
    label: '百川 (Baichuan)',
    protocol: 'openai-compat',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    apiKeyEnv: 'BAICHUAN_API_KEY',
    models: ['Baichuan4', 'Baichuan3-Turbo'],
    docs: 'https://platform.baichuan-ai.com/',
  },

  // ============ 国外 ============
  {
    name: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini', 'gpt-4o'],
    docs: 'https://platform.openai.com/docs/',
  },
  {
    name: 'claude',
    label: 'Claude (Anthropic)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    docs: 'https://docs.anthropic.com/',
  },
  {
    name: 'gemini',
    label: 'Gemini (Google)',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    docs: 'https://ai.google.dev/gemini-api/docs',
  },

  // ============ 特殊 ============
  {
    name: 'arkcli',
    label: 'Coding Plan (arkcli)',
    protocol: 'arkcli',
    baseUrl: '',
    apiKeyEnv: '',
    models: [],
    docs: '走本机 arkcli CLI，需 arkcli auth login',
  },
  {
    name: 'mock',
    label: 'Mock (开发)',
    protocol: 'mock',
    baseUrl: '',
    apiKeyEnv: '',
    models: [],
    docs: '回显用户输入，零费用',
  },
]

/** 按名字查 preset（含旧名别名） */
export function findPreset (name: string): ProviderPreset | undefined {
  const direct = PROVIDER_PRESETS.find(p => p.name === name)
  if (direct) return direct
  // 旧名兼容：ark 是 doubao（火山方舟）的旧称
  if (name === 'ark') return findPreset('doubao')
  return undefined
}

/** 所有已知 provider 名（供配置校验与错误提示；不含别名） */
export const PROVIDER_NAMES: string[] = PROVIDER_PRESETS.map(p => p.name)

/** 配置校验用的合法 provider 名（含旧名别名） */
export const PROVIDER_NAMES_WITH_ALIASES: string[] = [...PROVIDER_NAMES, 'ark']
