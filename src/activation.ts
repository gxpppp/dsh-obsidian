/**
 * On-demand activation: Obsidian tools and guidance are injected per agent
 * only when a user message matches the trigger vocabulary. A session that
 * never mentions Obsidian stays completely free of the tool schemas and the
 * prompt rules — like an unconnected MCP server. Activation is scoped to
 * exactly one agent (its own `agent.ctx` layer), idempotent per agent, and
 * unwinds automatically when the agent is disposed.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerFileTools } from './tools/files.ts'
import { registerEditorTools } from './tools/editor.ts'
import { buildObsidianGuidance, buildInlineEditRules, SECTION_ORDER } from './prompt/section.ts'
import type { ToolHost } from './tools/context.ts'

/** Default trigger vocabulary (case-insensitive substring match). */
export const DEFAULT_TRIGGER_KEYWORDS: readonly string[] = [
  'obsidian', 'vault', '笔记', '日记', '记笔记', '写日记', '知识库', '知识管理',
  '当前笔记', '选中文本', '帮我改这段', 'wikilink', 'frontmatter',
  'capture', 'journal',
]

/** Pure trigger test: any keyword present in the message content. */
export function matchesTrigger(content: string, keywords: readonly string[]): boolean {
  if (!content) return false
  const lower = content.toLowerCase()
  return keywords.some((keyword) => keyword !== '' && lower.includes(keyword.toLowerCase()))
}

/**
 * Extract plain text from a model message content: `UserMessage.content` is a
 * `ContentBlock[]` array (text blocks carry `.text`; image/tool blocks carry
 * none), but a string is accepted for tolerance.
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join(' ')
}

const activated = new WeakSet<Agent>()

/**
 * Register the activation listeners on the host context. Two channels feed
 * the same idempotent activation, so a trigger fires whichever event the
 * harness delivers:
 * - `agent/inbox/inserted` — the agent-facing path (payload carries the agent
 *   directly).
 * - `session/event` (`user/message`) — the durable session log path every
 *   GUI message must pass; the agent is resolved via `ctx.agents.get(sessionId)`.
 * Returns the combined disposer.
 */
/**
 * Watch the activation channels and record every step to a workspace log file
 * (activation.log next to the package root), so a silent activation failure
 * is observable from outside the harness. Replace `log` for tests.
 */
export function fileActivationLog(projectRoot: string): (message: string, error?: unknown) => void {
  const logPath = join(projectRoot, 'activation.log')
  return (message, error) => {
    try {
      const line = `[${new Date().toISOString()}] ${message}${error !== undefined ? ' :: ' + (error instanceof Error ? error.stack ?? error.message : String(error)) : ''}\n`
      appendFileSync(logPath, line, 'utf8')
    } catch {
      /* logging must never break activation */
    }
  }
}

export function watchActivation(
  ctx: Context,
  keywords: readonly string[],
  makeHost: () => ToolHost,
  log: (message: string, error?: unknown) => void = () => undefined,
): () => void {
  const agents = ctx.get('agents')
  const disposers: Array<() => void> = []

  const tryActivate = (agent: Agent | undefined): void => {
    if (agent === undefined) {
      log('[dsh-obsidian] trigger hit but no agent resolved')
      return
    }
    try {
      activateAgent(agent, makeHost)
      log(`[dsh-obsidian] activated agent ${agent.id}`)
    } catch (error) {
      log(`[dsh-obsidian] activation FAILED for agent ${agent.id}`, error)
    }
  }

  disposers.push(ctx.on('agent/inbox/inserted', ({ agent, message }: { agent: Agent; message: { content: unknown } }) => {
    const content = extractText(message.content)
    log(`[dsh-obsidian] inbox event content=${content.slice(0, 80)}`)
    if (matchesTrigger(content, keywords)) tryActivate(agent)
  }))

  disposers.push(ctx.on('session/event', (session, event: { type: string; message?: { content: unknown } }) => {
    if (event.type !== 'user/message') return
    const content = extractText(event.message?.content)
    log(`[dsh-obsidian] session event content=${content.slice(0, 80)}`)
    if (!matchesTrigger(content, keywords)) return
    tryActivate(agents?.get(session.id))
  }))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * Inject the full Obsidian surface (14 tools + guidance section) into ONE
 * agent's scoped context. Registered through `agent.ctx`, so the tools are
 * visible to that agent alone; the section text is a provider re-evaluated at
 * every prompt assembly, so it always reflects the latest config.
 */
export function activateAgent(agent: Agent, makeHost: () => ToolHost): void {
  if (activated.has(agent)) return
  const host = makeHost()
  const tools: ToolDefinition[] = [...registerFileTools(host), ...registerEditorTools(host)]
  for (const tool of tools) agent.ctx.tools.register(tool)
  agent.ctx.systemPrompt.section({
    name: 'plugin:obsidian',
    order: SECTION_ORDER,
    text: () => {
      const config = makeHost().config()
      return buildObsidianGuidance(config.vaultPath, config.mode ?? 'auto') + '\n\n' + buildInlineEditRules()
    },
  })
  activated.add(agent)
}
