import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { normalizeVaultPath } from '../vault/vaultPaths.ts'
import { jsonOutput, openObjectOutput, safeModelText } from './helpers.ts'
import type { ToolHost } from './context.ts'

export function registerEditorTools(host: ToolHost): ToolDefinition[] {
  const active = defineTool({
    name: 'obsidian_active',
    description: 'Read the active Obsidian note, document revision, exact selection offsets/text, cursor, open tabs, and optional content. Requires companion.',
    parameters: { include_content: { type: 'boolean' } },
    output: openObjectOutput((value) => {
      if (!value.active) return `No active Obsidian note: ${safeModelText(value.error)}`
      const lines = [`Active note: ${safeModelText(value.path)}; revision=${safeModelText(value.revision)}`]
      if (value.selection) {
        const selection = value.selection as Record<string, unknown>
        lines.push(['selection from=', String(selection.from), ' to=', String(selection.to), ' text=', safeModelText(selection.text, 2000)].join(''))
      }
      if (value.cursor) lines.push(`cursor=${safeModelText(JSON.stringify(value.cursor))}`)
      return lines.join('\n')
    }),
    execute: async (args, exec) => {
      const state = await host.bridge().activeState(exec.signal, args.include_content === true)
      if (state === null) return { active: false, path: '', mode: 'other', channel: 'none', revision: '', selection: null, cursor: null, openTabs: [], content: '', error: 'Companion is unavailable.' }
      if (!state.path) return { active: false, path: '', mode: state.mode, channel: state.channel, revision: state.revision, selection: null, cursor: null, openTabs: state.openTabs, content: '', error: 'No Markdown note is open.' }
      return {
        active: true,
        path: state.path,
        mode: state.mode,
        channel: state.channel,
        revision: state.revision,
        selection: state.selection,
        cursor: state.cursor,
        openTabs: state.openTabs,
        content: args.include_content ? (state.content ?? '') : '',
        error: '',
      }
    },
    isConcurrencySafe: () => true,
  })

  const inlineEdit = defineTool({
    name: 'obsidian_inline_edit',
    description: 'Replace the current selection or insert at the cursor. The companion checks path, document revision, offsets, and expected text before changing anything.',
    parameters: { text: { type: 'string', required: true } },
    output: openObjectOutput((value) => `Inline edit applied to ${safeModelText(value.path)}; revision ${safeModelText(value.revision)}`),
    execute: async (args, exec) => {
      const state = await host.bridge().activeState(exec.signal)
      if (state === null || !state.path) throw new Error('No active Obsidian note')
      let from: number
      let to: number
      let expectedText: string
      if (state.selection) {
        from = state.selection.from
        to = state.selection.to
        expectedText = state.selection.text
      } else if (state.cursor) {
        from = state.cursor.offset
        to = from
        expectedText = ''
      } else throw new Error('The companion did not report a selection or cursor')
      const result = await host.bridge().applyEdit({ path: state.path, from, to, text: args.text, revision: state.revision, expectedText }, exec.signal)
      return { ok: true, path: state.path, from, to, replacedLength: expectedText.length, revision: result.revision }
    },
  })

  const open = defineTool({
    name: 'obsidian_open',
    description: 'Open a vault note in Obsidian and optionally move the cursor to a 1-based line. Requires companion.',
    parameters: { path: { type: 'string', required: true }, line: { type: 'number' } },
    output: openObjectOutput((value) => `Opened ${safeModelText(value.path)} in Obsidian`),
    execute: async (args, exec) => {
      const notePath = normalizeVaultPath(args.path)
      await host.bridge().openNote({ path: notePath, line: args.line }, exec.signal)
      return { opened: true, path: notePath }
    },
  })

  const commands = defineTool({
    name: 'obsidian_commands_list',
    description: 'List available Obsidian command ids and names. Requires companion.',
    parameters: { query: { type: 'string' }, limit: { type: 'number' } },
    output: openObjectOutput((value) => {
      const items = Array.isArray(value.commands) ? value.commands : []
      return items.length ? items.map((item) => {
        const command = item as Record<string, unknown>
        return [safeModelText(command.id), ': ', safeModelText(command.name)].join('')
      }).join('\n') : '(no matching commands)'
    }),
    execute: async (args, exec) => {
      const query = args.query?.toLowerCase()
      let items = await host.bridge().listCommands(exec.signal)
      if (query) items = items.filter((item) => item.id.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
      return { commands: items.slice(0, Math.max(1, Math.min(1000, args.limit ?? 200))) }
    },
    isConcurrencySafe: () => true,
  })

  const command = defineTool({
    name: 'obsidian_command',
    description: 'Execute an exact Obsidian command id. Subject to command policy and DSH approval. Unknown or failed commands return an error.',
    parameters: { id: { type: 'string', required: true } },
    output: openObjectOutput((value) => `Executed Obsidian command ${safeModelText(value.id)}`),
    execute: async (args, exec) => {
      if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(args.id)) throw new Error('Invalid Obsidian command id')
      await host.bridge().executeCommand(args.id, exec.signal)
      return { executed: true, id: args.id }
    },
  })

  const notice = defineTool({
    name: 'obsidian_notice',
    description: 'Show a short transient notice inside Obsidian. Requires companion.',
    parameters: { message: { type: 'string', required: true } },
    output: openObjectOutput(() => 'Notice displayed in Obsidian'),
    execute: async (args, exec) => {
      const message = args.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 4000)
      await host.bridge().notice(message, exec.signal)
      return { shown: true }
    },
  })

  return [active, inlineEdit, open, commands, command, notice]
}

function cursorOffset(content: string, line: number, ch: number): number {
  const lines = content.split('\n')
  const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1))
  const character = Math.max(0, Math.min(lines[lineIndex].length, ch))
  return lines.slice(0, lineIndex).reduce((total, value) => total + value.length + 1, 0) + character
}
