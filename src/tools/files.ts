/**
 * Vault file tools (port of Claudian's VaultFileAdapter surface + DSH fs-tool
 * read-window conventions). All paths are vault-relative.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { requireFs, textBlock, type ToolHost } from './context.ts'
import type { VaultFs } from '../vault/vaultFs.ts'

/** 1-based line-numbered read window (DSH read-tool convention). */
const READ_LIMIT_DEFAULT = 2000

export function registerFileTools(host: ToolHost): ToolDefinition[] {
  const vault = (): VaultFs => requireFs(host)

  const list = defineTool({
    name: 'obsidian_list',
    description: 'List files and folders in the Obsidian vault (vault-relative paths; dot-directories like .obsidian are hidden).',
    parameters: {
      folder: { type: 'string', description: 'Vault-relative folder to list; omit or "" for the vault root.' },
      recursive: { type: 'boolean', description: 'Recurse into subfolders (bounded at 2000 entries).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          folder: { type: 'string', required: true },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', required: true },
                kind: { type: 'string', enum: ['file', 'folder'], required: true },
                size: { type: 'number', required: true },
              },
              additionalProperties: false,
            },
            required: true,
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const lines = (value.entries ?? []).map((e) => `${e.kind === 'folder' ? '[dir] ' : ''}${e.path}${e.kind === 'file' ? ` (${e.size} B)` : ''}`)
        return [textBlock(lines.length ? lines.join('\n') : '(empty folder)')]
      },
    },
    execute: async (args) => {
      const folder = args.folder ?? ''
      const entries = args.recursive
        ? await vault().listTree(folder)
        : await vault().listFolder(folder)
      return { folder: folder || '/', entries: entries.map((e) => ({ path: e.path, kind: e.kind, size: e.size })) }
    },
  })

  const read = defineTool({
    name: 'obsidian_read',
    description: 'Read a vault note (UTF-8). Returns line-numbered content; offset is 1-based, limit caps at 2000 lines.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path, e.g. notes/foo.md', required: true },
      offset: { type: 'number', description: '1-based first line to return.' },
      limit: { type: 'number', description: 'Max lines to return (default/cap 2000).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'number', required: true },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { number: { type: 'number', required: true }, text: { type: 'string', required: true } },
              additionalProperties: false,
            },
            required: true,
          },
          totalLines: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const lines = (value.lines ?? []).slice(0, 5).map((l) => `${l.number}: ${l.text}`).join('\n')
        const tail = (value.lines?.length ?? 0) > 10 ? `\n... ${(value.lines?.length ?? 0) - 10} more lines` : ''
        return [textBlock(`${value.path} (${value.totalLines} lines, from line ${value.offset})\n${lines}${tail}`)]
      },
    },
    execute: async (args) => {
      const content = await vault().read(args.path)
      const lines = content.split('\n')
      const limit = Math.max(1, Math.min(args.limit ?? READ_LIMIT_DEFAULT, READ_LIMIT_DEFAULT))
      const offset = Math.max(1, args.offset ?? 1)
      const windowLines = lines.slice(offset - 1, offset - 1 + limit)
      return {
        path: args.path,
        offset,
        lines: windowLines.map((text, i) => ({ number: offset + i, text })),
        totalLines: lines.length,
      }
    },
  })

  const write = defineTool({
    name: 'obsidian_write',
    description: 'Create or fully replace a vault note. Parent folders are created automatically.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
      content: { type: 'string', description: 'Full new content.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', enum: ['create', 'update'], required: true },
          bytes: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(`${value.operation === 'create' ? 'Created' : 'Updated'} ${value.path} (${value.bytes} bytes)`)],
    },
    execute: async (args) => {
      const existed = await vault().exists(args.path)
      await vault().write(args.path, args.content)
      const operation: 'create' | 'update' = existed ? 'update' : 'create'
      return { path: args.path, operation, bytes: Buffer.byteLength(args.content, 'utf8') }
    },
  })

  const edit = defineTool({
    name: 'obsidian_edit',
    description: 'Literal string replacement inside a vault note. The old_string must match exactly once unless replace_all is true.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
      old_string: { type: 'string', description: 'Literal text to replace (must exist).', required: true },
      new_string: { type: 'string', description: 'Replacement text.', required: true },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          count: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(`Edited ${value.path}: ${value.count} replacement(s)`)],
    },
    execute: async (args) => {
      const content = await vault().read(args.path)
      const count = content.split(args.old_string).length - 1
      if (count === 0) throw new Error(`old_string not found in ${args.path}`)
      if (count > 1 && !args.replace_all) {
        throw new Error(`old_string matches ${count} times; set replace_all=true or narrow the match`)
      }
      const next = args.replace_all ? content.split(args.old_string).join(args.new_string) : content.replace(args.old_string, args.new_string)
      await vault().write(args.path, next)
      return { path: args.path, count }
    },
  })

  const append = defineTool({
    name: 'obsidian_append',
    description: 'Append text to a vault note (creates it if missing). Appends are serialized, so concurrent appends never lose text.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
      content: { type: 'string', description: 'Text to append.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          size: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(`Appended to ${value.path} (now ${value.size} bytes)`)],
    },
    execute: async (args) => {
      await vault().append(args.path, args.content)
      const st = await vault().stat(args.path)
      return { path: args.path, size: st.size }
    },
  })

  const del = defineTool({
    name: 'obsidian_delete',
    description: 'Delete a vault note (file). Folders are removed only when empty; use obsidian_list to inspect first.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          deleted: { type: 'boolean', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(`Deleted ${value.path}`)],
    },
    execute: async (args) => {
      await vault().delete(args.path)
      return { path: args.path, deleted: true }
    },
  })

  const move = defineTool({
    name: 'obsidian_move',
    description: 'Move or rename a vault note. Target parent folders are created automatically.',
    parameters: {
      source: { type: 'string', description: 'Current vault-relative path.', required: true },
      target: { type: 'string', description: 'New vault-relative path.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          source: { type: 'string', required: true },
          target: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [textBlock(`Moved ${value.source} -> ${value.target}`)],
    },
    execute: async (args) => {
      await vault().move(args.source, args.target)
      return { source: args.source, target: args.target }
    },
  })

  const search = defineTool({
    name: 'obsidian_search',
    description: 'Case-insensitive text search across vault notes (.md/.markdown/.txt/.canvas/.json), returning matching lines.',
    parameters: {
      query: { type: 'string', description: 'Search text or regular expression.', required: true },
      folder: { type: 'string', description: 'Restrict search to a vault-relative folder.' },
      limit: { type: 'number', description: 'Max hits (default 50).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          hits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', required: true },
                lineNumber: { type: 'number', required: true },
                line: { type: 'string', required: true },
              },
              additionalProperties: false,
            },
            required: true,
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if ((value.hits ?? []).length === 0) return [textBlock('(no matches)')]
        const lines = (value.hits ?? []).map((h) => `${h.path}:${h.lineNumber}: ${h.line}`)
        return [textBlock(lines.join('\n'))]
      },
    },
    execute: async (args) => {
      const hits = await vault().search(args.folder ?? '', args.query, args.limit ?? 50)
      return { hits }
    },
  })

  const metadata = defineTool({
    name: 'obsidian_metadata',
    description: 'Read the frontmatter (YAML header), tags, wikilinks, size and mtime of a vault note.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          size: { type: 'number', required: true },
          mtime: { type: 'number', required: true },
          frontmatter: { type: 'json', required: true },
          tags: { type: 'array', items: { type: 'string' }, required: true },
          wikilinks: { type: 'array', items: { type: 'string' }, required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const parts = [`${value.path} (${value.size} B, mtime ${new Date(value.mtime).toISOString()})`]
        if (value.frontmatter !== undefined) parts.push('frontmatter: ' + JSON.stringify(value.frontmatter))
        if ((value.tags ?? []).length) parts.push('tags: ' + (value.tags ?? []).join(', '))
        if ((value.wikilinks ?? []).length) parts.push('wikilinks: ' + (value.wikilinks ?? []).join(', '))
        return [textBlock(parts.join('\n'))]
      },
    },
    execute: async (args) => {
      const content = await vault().read(args.path)
      const st = await vault().stat(args.path)
      let frontmatter: JsonValue = null
      let body = content
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
      if (fmMatch) {
        body = content.slice(fmMatch[0].length)
        try {
          // Minimal YAML-ish parse: only flat key: value lines; anything complex stays raw text.
          const raw: Record<string, unknown> = {}
          for (const line of fmMatch[1].split(/\r?\n/)) {
            const m = /^([A-Za-z0-9_ .-]+):\s*(.*)$/.exec(line)
            if (m) raw[m[1].trim()] = parseScalar(m[2])
          }
          if (Object.keys(raw).length > 0) frontmatter = raw as unknown as JsonValue
          else frontmatter = fmMatch[1] as unknown as JsonValue
        } catch {
          frontmatter = fmMatch[1] as unknown as JsonValue
        }
      }
      const tags = Array.from(new Set(
        [...body.matchAll(/(?:^|\s)#([A-Za-z0-9_\-\/\u4e00-\u9fa5]+)/g)].map((m) => m[1]),
      ))
      const wikilinks = Array.from(new Set(
        [...content.matchAll(/\[\[([^\[\]|#]+?)(?:\|[^\[\]]*?)?\]\]/g)].map((m) => m[1].trim()),
      ))
      return { path: args.path, size: st.size, mtime: st.mtime, frontmatter, tags, wikilinks }
    },
  })

  return [list, read, write, edit, append, del, move, search, metadata]
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === '') return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d+\.\d+$/.test(value)) return Number(value)
  const quoted = /^['"](.*)['"]$/.exec(value)
  if (quoted) return quoted[1]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((s) => parseScalar(s)).filter((s) => s !== '')
  }
  return value
}
