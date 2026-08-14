/**
 * Plugin configuration (validated by the same-named schemastery schema).
 */
import z from 'schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Connection mode: auto picks the best available channel per operation. */
export type BridgeMode = 'auto' | 'fs' | 'companion' | 'rest'

export interface Config {
  /** Absolute path to the Obsidian vault root. */
  vaultPath?: string
  /** Channel selection. */
  mode: BridgeMode
  /** Local REST API plugin base URL (default http://127.0.0.1:27123). */
  restUrl: string
  /** Local REST API plugin API key. */
  restToken?: string
  /** Companion bridge port (default 34567). */
  companionPort: number
  /** Companion bridge bearer token; empty = read from vault plugin data if possible. */
  companionToken?: string
  /** Poll interval for active-note state, ms (0 disables polling). */
  pollMs: number
  /** Keep .obsidian config files hidden from file tools. */
  protectDotObsidian: boolean
  /**
   * Register the on-demand `obsidian` skill (one catalog line; full guidance
   * loads only when the model or user asks for it). This is the only
   * always-on presence — tools and prompt rules are never pre-injected.
   */
  announceToAgent: boolean
  /**
   * On-demand activation: when a user message matches `triggerKeywords`,
   * register the obsidian_* tools + guidance into THAT agent's scope only.
   * Other sessions never see the tools (like an unconnected MCP server).
   */
  autoActivate: boolean
  /** Trigger vocabulary matched against each user message (substring, case-insensitive). */
  triggerKeywords: string[]
  /** Master switch (browser half + host tools). */
  enabled: boolean
}

export const DEFAULT_CONFIG: Config = {
  vaultPath: undefined,
  mode: 'auto',
  restUrl: 'http://127.0.0.1:27123',
  restToken: undefined,
  companionPort: 34567,
  companionToken: undefined,
  pollMs: 1500,
  protectDotObsidian: true,
  announceToAgent: true,
  autoActivate: true,
  triggerKeywords: [
    'obsidian', 'vault', '笔记', '日记', '记笔记', '写日记', '知识库', '知识管理',
    '当前笔记', '选中文本', '帮我改这段', 'wikilink', 'frontmatter',
    'capture', 'journal',
  ],
  enabled: true,
}

export const Config: z<Config> = z.object({
  vaultPath: z.string().required(false),
  mode: z
    .union([z.const('auto'), z.const('fs'), z.const('companion'), z.const('rest')])
    .default('auto'),
  restUrl: z.string().default(DEFAULT_CONFIG.restUrl),
  restToken: z.string().role('secret').required(false),
  companionPort: z.number().default(DEFAULT_CONFIG.companionPort),
  companionToken: z.string().role('secret').required(false),
  pollMs: z.number().default(DEFAULT_CONFIG.pollMs),
  protectDotObsidian: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  autoActivate: z.boolean().default(true),
  triggerKeywords: z.array(z.string()).default([
    'obsidian', 'vault', '笔记', '日记', '记笔记', '写日记', '知识库', '知识管理',
    '当前笔记', '选中文本', '帮我改这段', 'wikilink', 'frontmatter',
    'capture', 'journal',
  ]),
  enabled: z.boolean().default(true),
})

/** Settings namespace the web settings surface edits (kebab-case, per dsh-settings). */
export const OBSIDIAN_SETTINGS_NAMESPACE = settingsNamespace('obsidian')
