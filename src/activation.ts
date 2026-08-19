import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { registerFileTools } from './tools/files.ts'
import { registerEditorTools } from './tools/editor.ts'
import { buildObsidianGuidance, buildInlineEditRules, SECTION_ORDER } from './prompt/section.ts'
import type { ToolHost } from './tools/context.ts'
import type { ApprovalMode, CommandPolicy } from './settings/schema.ts'

export const DEFAULT_TRIGGER_KEYWORDS: readonly string[] = [
  'obsidian', 'vault', '笔记', '日记', '记笔记', '写日记', '知识库', '知识管理',
  '当前笔记', '选中文本', '帮我改这段', 'wikilink', 'frontmatter', '附件', '反向链接',
  'capture', 'journal', 'backlink', 'attachment',
]

const WRITE_TOOLS = new Set([
  'obsidian_write', 'obsidian_edit', 'obsidian_append', 'obsidian_mkdir',
  'obsidian_copy', 'obsidian_move', 'obsidian_delete', 'obsidian_inline_edit',
  'obsidian_frontmatter_update', 'obsidian_attachment_add', 'obsidian_link_insert',
  'obsidian_notice',
])
const DANGEROUS_TOOLS = new Set(['obsidian_delete', 'obsidian_command'])

export function matchesTrigger(content: string, keywords: readonly string[]): boolean {
  if (!content) return false
  const lower = content.toLowerCase()
  return keywords.some((keyword) => keyword.trim() !== '' && lower.includes(keyword.toLowerCase()))
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { text: string } => block !== null
      && typeof block === 'object'
      && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join(' ')
}

export interface ActivationController {
  activate(agent: Agent): void
  deactivate(agent: Agent): void
  dispose(): void
}

export interface ActivationLog {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

export function watchActivation(
  ctx: Context,
  keywords: readonly string[],
  makeHost: () => ToolHost,
  log: ActivationLog = ctx.logger('dsh-obsidian'),
): ActivationController {
  const agents = ctx.get('agents')
  const active = new Map<Agent, () => void>()
  const listenerDisposers: Array<() => void> = []

  const activate = (agent: Agent): void => {
    if (active.has(agent)) return
    try {
      active.set(agent, activateAgent(agent, makeHost))
      log.info('activated Obsidian tools for agent %s', agent.id)
    } catch (error) {
      log.warn('failed to activate Obsidian tools for agent %s: %s', agent.id, error instanceof Error ? error.message : String(error))
    }
  }

  const deactivate = (agent: Agent): void => {
    const dispose = active.get(agent)
    if (dispose === undefined) return
    active.delete(agent)
    dispose()
  }

  listenerDisposers.push(ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (matchesTrigger(extractText(message.content), keywords)) activate(agent)
  }))

  listenerDisposers.push(ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    if (!matchesTrigger(extractText(event.data.content), keywords)) return
    const agent = agents?.get(session.id)
    if (agent !== undefined) activate(agent)
  }))

  listenerDisposers.push(ctx.on('agent/disposed', ({ agent }) => deactivate(agent)))

  return {
    activate,
    deactivate,
    dispose: () => {
      for (const dispose of listenerDisposers.splice(0).reverse()) dispose()
      for (const dispose of [...active.values()].reverse()) dispose()
      active.clear()
    },
  }
}

export function activateAgent(agent: Agent, makeHost: () => ToolHost): () => void {
  const host = makeHost()
  const tools: ToolDefinition[] = [...registerFileTools(host), ...registerEditorTools(host)]
  const disposers: Array<() => void> = []
  try {
    for (const tool of tools) disposers.push(agent.ctx.tools.register(tool))
    disposers.push(agent.ctx.systemPrompt.section({
      name: 'plugin:obsidian',
      order: SECTION_ORDER,
      text: () => {
        const config = makeHost().config()
        return `${buildObsidianGuidance(config.vaultPath, config.mode)}\n\n${buildInlineEditRules()}`
      },
    }))
    disposers.push(agent.ctx.on('tools/pre-execute', async (exec, next) => approvalDecision(exec, makeHost().config().approvalMode, makeHost().config().commandPolicy, makeHost().config().commandAllowlist, next)))
  } catch (error) {
    for (const dispose of disposers.splice(0).reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}

async function approvalDecision(
  exec: Readonly<ToolExecution>,
  mode: ApprovalMode,
  commandPolicy: CommandPolicy,
  commandAllowlist: readonly string[],
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (!exec.name.startsWith('obsidian_')) return next()
  if (exec.name === 'obsidian_command') {
    const id = typeof exec.arguments === 'object' && exec.arguments !== null
      ? (exec.arguments as { id?: unknown }).id
      : undefined
    if (commandPolicy === 'deny') return { kind: 'deny', reason: 'Obsidian command execution is disabled by policy.' }
    if (commandPolicy === 'allowlist' && (typeof id !== 'string' || !commandAllowlist.includes(id))) {
      return { kind: 'deny', reason: 'This Obsidian command is not in commandAllowlist.' }
    }
    if (commandPolicy === 'approval') return { kind: 'ask', reason: `Execute Obsidian command ${String(id ?? '')}` }
  }
  if (mode === 'all') return { kind: 'ask', reason: `Run ${exec.name}` }
  if (mode === 'writes' && WRITE_TOOLS.has(exec.name)) return { kind: 'ask', reason: `Run write operation ${exec.name}` }
  if (mode === 'dangerous' && DANGEROUS_TOOLS.has(exec.name)) return { kind: 'ask', reason: `Run potentially destructive operation ${exec.name}` }
  return next()
}
