import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'

export type BridgeMode = 'auto' | 'fs' | 'companion'
export type ApprovalMode = 'none' | 'dangerous' | 'writes' | 'all'
export type CommandPolicy = 'deny' | 'allowlist' | 'approval'

export interface Config {
  vaultPath?: string
  mode: BridgeMode
  companionEndpoint?: string
  companionToken?: string
  protectedPaths: string[]
  maxTextBytes: number
  attachmentFolder: string
  maxAttachmentBytes: number
  approvalMode: ApprovalMode
  commandPolicy: CommandPolicy
  commandAllowlist: string[]
  announceToAgent: boolean
  autoActivate: boolean
  triggerKeywords: string[]
  enabled: boolean
}

export const DEFAULT_CONFIG: Config = {
  vaultPath: undefined,
  mode: 'auto',
  companionEndpoint: undefined,
  companionToken: undefined,
  protectedPaths: ['.obsidian', '.trash', '.git', '.claudian'],
  maxTextBytes: 5 * 1024 * 1024,
  attachmentFolder: 'Attachments',
  maxAttachmentBytes: 25 * 1024 * 1024,
  approvalMode: 'dangerous',
  commandPolicy: 'approval',
  commandAllowlist: [],
  announceToAgent: true,
  autoActivate: true,
  triggerKeywords: [
    'obsidian', 'vault', '笔记', '日记', '记笔记', '写日记', '知识库', '知识管理',
    '当前笔记', '选中文本', '帮我改这段', 'wikilink', 'frontmatter', '附件', '反向链接',
    'capture', 'journal', 'backlink', 'attachment',
  ],
  enabled: true,
}

export const Config: z<Config> = z.object({
  vaultPath: z.string().required(false),
  mode: z.union([z.const('auto'), z.const('fs'), z.const('companion')]).default('auto'),
  companionEndpoint: z.string().required(false),
  companionToken: z.string().role('secret').required(false),
  protectedPaths: z.array(z.string()).default([...DEFAULT_CONFIG.protectedPaths]),
  maxTextBytes: z.number().default(DEFAULT_CONFIG.maxTextBytes),
  attachmentFolder: z.string().default(DEFAULT_CONFIG.attachmentFolder),
  maxAttachmentBytes: z.number().default(DEFAULT_CONFIG.maxAttachmentBytes),
  approvalMode: z
    .union([z.const('none'), z.const('dangerous'), z.const('writes'), z.const('all')])
    .default(DEFAULT_CONFIG.approvalMode),
  commandPolicy: z
    .union([z.const('deny'), z.const('allowlist'), z.const('approval')])
    .default(DEFAULT_CONFIG.commandPolicy),
  commandAllowlist: z.array(z.string()).default([]),
  announceToAgent: z.boolean().default(true),
  autoActivate: z.boolean().default(true),
  triggerKeywords: z.array(z.string()).default([...DEFAULT_CONFIG.triggerKeywords]),
  enabled: z.boolean().default(true),
})

export function validateConfig(config: Config): void {
  if (config.vaultPath !== undefined && config.vaultPath !== '') {
    if (!isAbsolute(config.vaultPath)) throw new Error('vaultPath must be an absolute path')
    if (!existsSync(config.vaultPath) || !statSync(config.vaultPath).isDirectory()) {
      throw new Error('vaultPath must point to an existing directory')
    }
    realpathSync.native(config.vaultPath)
  }
  if (!Number.isSafeInteger(config.maxTextBytes) || config.maxTextBytes < 1024 || config.maxTextBytes > 100 * 1024 * 1024) {
    throw new Error('maxTextBytes must be an integer between 1024 and 104857600')
  }
  if (!Number.isSafeInteger(config.maxAttachmentBytes) || config.maxAttachmentBytes < 1024 || config.maxAttachmentBytes > 1024 * 1024 * 1024) {
    throw new Error('maxAttachmentBytes must be an integer between 1024 and 1073741824')
  }
  if (config.attachmentFolder === '' || isAbsolute(config.attachmentFolder) || config.attachmentFolder.includes('..') || config.attachmentFolder.includes('\\')) {
    throw new Error('attachmentFolder must be a normalized vault-relative folder')
  }
  if (config.protectedPaths.some((entry) => entry === '' || entry.includes('/') || entry.includes('\\') || !entry.startsWith('.'))) {
    throw new Error('protectedPaths entries must be top-level dot-directory names')
  }
  if (config.commandPolicy === 'allowlist' && config.commandAllowlist.length === 0) {
    throw new Error('commandAllowlist must not be empty when commandPolicy is allowlist')
  }
  if (config.mode === 'companion' && !config.vaultPath) {
    throw new Error('vaultPath is required when mode is companion')
  }
}

export const OBSIDIAN_SETTINGS_NAMESPACE = 'obsidian'
