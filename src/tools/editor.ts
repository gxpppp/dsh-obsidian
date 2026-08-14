/**
 * Editor tools (ports of Claudian's SelectionController + InlineEditService +
 * editor utils). These need the companion bridge (selection fidelity) or the
 * Local REST API channel (active file only) and a running Obsidian.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildSelectionContext, selectionContextToJson } from '../vault/editorContext.ts'
import { textBlock, type ToolHost } from './context.ts'

export function registerEditorTools(host: ToolHost): ToolDefinition[] {
  const active = defineTool({
    name: 'obsidian_active',
    description: 'Read the currently active note in Obsidian: path, editor mode, selection (with offsets) or cursor position, and the note content needed to build editor context. Fails with guidance when Obsidian is not running or no bridge is reachable.',
    parameters: {
      includeContent: { type: 'boolean', description: 'Include the full note content (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          active: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          channel: { type: 'string', required: true },
          selection: { type: 'json', required: true },
          cursor: { type: 'json', required: true },
          content: { type: 'string', required: true },
          error: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (!value.active) return [textBlock(`No active Obsidian note: ${value.error ?? 'bridge unreachable'}`)]
        const parts = [`Active note: ${value.path} (mode: ${value.mode}, channel: ${value.channel})`]
        if (value.selection) {
          const sel = value.selection as Record<string, unknown>
          parts.push(`selection: from=${String(sel.from)} to=${String(sel.to)} len=${String((sel.text as string | undefined)?.length ?? 0)}`)
          if (sel.text) parts.push('selected text:\n' + String(sel.text))
        }
        if (value.cursor) parts.push('cursor: ' + JSON.stringify(value.cursor))
        return [textBlock(parts.join('\n'))]
      },
    },
    execute: async (args) => {
      const state = await host.bridge().activeState()
      if (state === null) {
        return {
          active: false,
          path: '',
          mode: 'other',
          channel: 'none',
          selection: null as unknown as JsonValue,
          cursor: null as unknown as JsonValue,
          content: '',
          error: 'Obsidian is not reachable. Start Obsidian and install the companion bridge or the Local REST API plugin (see dsh-obsidian settings).',
        }
      }
      if (state.path === '') {
        // Bridge reachable but no note is open in Obsidian.
        return {
          active: false,
          path: '',
          mode: state.mode ?? 'other',
          channel: state.channel,
          selection: null as unknown as JsonValue,
          cursor: null as unknown as JsonValue,
          content: '',
          error: 'No note is open in Obsidian. Open a note (or use obsidian_open) and retry.',
        }
      }
      const fs = host.fs()
      let content = state.content
      if (content === undefined && fs !== null) {
        try {
          content = await fs.read(state.path)
        } catch {
          content = undefined
        }
      }
      const selection = state.selection && content !== undefined
        ? selectionContextToJson(buildSelectionContext(state.path, content, state.selection.from, state.selection.to)) as unknown as JsonValue
        : ((state.selection ?? null) as unknown as JsonValue)
      return {
        active: true,
        path: state.path,
        mode: state.mode,
        channel: state.channel,
        selection,
        cursor: (state.cursor ?? null) as unknown as JsonValue,
        content: args.includeContent ? (content ?? '') : '',
        error: '',
      }
    },
  })

  const inlineEdit = defineTool({
    name: 'obsidian_inline_edit',
    description: 'Replace the current selection in the active Obsidian editor with new text (Claudian-style inline edit). When there is no selection, inserts at the cursor. Requires the companion bridge and a running Obsidian. The text must be the final replacement content, styled like the writing of the user.',
    parameters: {
      text: { type: 'string', description: 'The replacement text to write into the editor.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          from: { type: 'number', required: true },
          to: { type: 'number', required: true },
          replacedLength: { type: 'number', required: true },
          error: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (!value.ok) return [textBlock(`Inline edit failed: ${value.error}`)]
        return [textBlock(`Inline edit applied to ${value.path} (chars ${value.from}-${value.to}, replaced ${value.replacedLength} chars)`)]
      },
    },
    execute: async (args) => {
      const state = await host.bridge().activeState()
      if (state === null) {
        return { ok: false, path: '', from: 0, to: 0, replacedLength: 0, error: 'Obsidian is not reachable (companion bridge required for inline edit).' }
      }
      const fs = host.fs()
      let content = state.content
      if (content === undefined && fs !== null) {
        try { content = await fs.read(state.path) } catch { content = undefined }
      }
      if (state.selection) {
        await host.bridge().applyEdit({ path: state.path, from: state.selection.from, to: state.selection.to, text: args.text })
        return { ok: true, path: state.path, from: state.selection.from, to: state.selection.to, replacedLength: state.selection.text?.length ?? 0, error: '' }
      }
      if (state.cursor && content !== undefined) {
        // Cursor mode: compute the offset from line/ch (1-based line, 0-based ch in the companion payload).
        const lines = content.split('\n')
        const line = Math.max(0, Math.min(state.cursor.line - 1, lines.length - 1))
        const ch = Math.max(0, Math.min(state.cursor.ch, lines[line].length))
        const from = lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + ch
        await host.bridge().applyEdit({ path: state.path, from, to: from, text: args.text })
        return { ok: true, path: state.path, from, to: from, replacedLength: 0, error: '' }
      }
      return { ok: false, path: state.path, from: 0, to: 0, replacedLength: 0, error: 'No selection or cursor position reported by the bridge; select text in Obsidian and retry.' }
    },
  })

  const open = defineTool({
    name: 'obsidian_open',
    description: 'Open a vault note in Obsidian, optionally scrolling to a 1-based line. Requires the companion bridge or the Local REST API plugin.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
      line: { type: 'number', description: '1-based line to scroll to.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          error: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(value.ok ? `Opened ${value.path} in Obsidian` : `Open failed: ${value.error}`)],
    },
    execute: async (args) => {
      try {
        await host.bridge().openNote({ path: args.path, line: args.line })
        return { ok: true, path: args.path, error: '' }
      } catch (error) {
        return { ok: false, path: args.path, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const command = defineTool({
    name: 'obsidian_command',
    description: 'Execute any Obsidian command by its id (e.g. "editor:insert-wikilink", "app:go-back"). Use obsidian_commands_list first when unsure. Requires the companion bridge or the Local REST API plugin.',
    parameters: {
      id: { type: 'string', description: 'Obsidian command id.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          error: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(value.ok ? `Executed command ${value.id}` : `Command failed: ${value.error}`)],
    },
    execute: async (args) => {
      try {
        await host.bridge().executeCommand(args.id)
        return { ok: true, id: args.id, error: '' }
      } catch (error) {
        return { ok: false, id: args.id, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const commandsList = defineTool({
    name: 'obsidian_commands_list',
    description: 'List Obsidian commands (id + name) so an exact command id can be chosen for obsidian_command. Requires the companion bridge or the Local REST API plugin.',
    parameters: {
      limit: { type: 'number', description: 'Max commands (default 200).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
              additionalProperties: false,
            },
            required: true,
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if ((value.commands ?? []).length === 0) return [textBlock('(no commands reported)')]
        return [textBlock((value.commands ?? []).map((c) => `${c.id}: ${c.name}`).join('\n'))]
      },
    },
    execute: async (args) => {
      const commands = await host.bridge().listCommands()
      return { commands: commands.slice(0, Math.max(1, args.limit ?? 200)) }
    },
  })

  return [active, inlineEdit, open, command, commandsList]
}
