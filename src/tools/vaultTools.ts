import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { requireFs, type ToolHost } from './context.ts'
import { compact, openObjectOutput, safeModelText } from './helpers.ts'

export function registerVaultTools(host: ToolHost): ToolDefinition[] {
  const status = defineTool({
    name: 'obsidian_status',
    description: 'Report vault configuration, active channel, companion versions, capabilities, and vault identity match without exposing secrets.',
    parameters: {},
    output: openObjectOutput((value) => [
      `configured=${String(value.configured)}`,
      `channel=${safeModelText(value.channel)}`,
      `companion=${String(value.companion)}`,
      safeModelText(value.detail),
    ].filter(Boolean).join('\n')),
    execute: async (_args, exec) => {
      const config = host.config()
      const bridge = await host.bridge().status(exec.signal)
      return compact({
        configured: Boolean(config.vaultPath),
        vaultPath: config.vaultPath ?? '',
        mode: config.mode,
        channel: bridge.channel,
        companion: bridge.ok && bridge.channel === 'companion',
        vaultMatch: bridge.vaultMatch,
        protocolVersion: bridge.protocolVersion,
        pluginVersion: bridge.pluginVersion,
        obsidianVersion: bridge.obsidianVersion,
        capabilities: bridge.capabilities,
        detail: bridge.detail ?? '',
      })
    },
    isConcurrencySafe: () => true,
  })

  const list = defineTool({
    name: 'obsidian_list',
    description: 'List vault files and folders. Protected dot-directories are never returned.',
    parameters: {
      folder: { type: 'string', description: 'Vault-relative folder; omit for root.' },
      recursive: { type: 'boolean', description: 'Recursively list entries.' },
      max_entries: { type: 'number', description: 'Maximum entries, hard-capped at 5000.' },
    },
    output: openObjectOutput((value) => {
      const entries = Array.isArray(value.entries) ? value.entries : []
      if (entries.length === 0) return '(empty folder)'
      return entries.map((entry) => {
        const record = entry as Record<string, unknown>
        return `${record.kind === 'folder' ? '[dir] ' : ''}${safeModelText(record.path)}`
      }).join('\n')
    }),
    execute: async (args, exec) => {
      const vault = requireFs(host)
      const folder = args.folder ?? ''
      const entries = args.recursive
        ? await vault.listTree(folder, Math.max(1, Math.min(5000, args.max_entries ?? 2000)), exec.signal)
        : await vault.listFolder(folder, exec.signal)
      return { folder: folder || '/', entries: entries.map(entryResult) }
    },
    isConcurrencySafe: () => true,
  })

  const stat = defineTool({
    name: 'obsidian_stat',
    description: 'Read a vault path type, byte size, modification time, and SHA-256 revision.',
    parameters: { path: { type: 'string', description: 'Vault-relative path.', required: true } },
    output: openObjectOutput((value) => `${safeModelText(value.path)}: ${safeModelText(value.kind)}, ${String(value.size)} bytes${value.revision ? `, revision ${safeModelText(value.revision)}` : ''}`),
    execute: async (args, exec) => entryResult(await requireFs(host).stat(args.path, exec.signal)),
    isConcurrencySafe: () => true,
  })

  const read = defineTool({
    name: 'obsidian_read',
    description: 'Read a UTF-8 vault note with line numbers and its SHA-256 revision for conflict-safe updates.',
    parameters: {
      path: { type: 'string', description: 'Vault-relative note path.', required: true },
      offset: { type: 'number', description: '1-based first line.' },
      limit: { type: 'number', description: 'Maximum 2000 lines.' },
    },
    output: openObjectOutput((value) => {
      const lines = Array.isArray(value.lines) ? value.lines : []
      return [`${safeModelText(value.path)} revision=${safeModelText(value.revision)}`, ...lines.map((line) => {
        const record = line as Record<string, unknown>
        return `${String(record.number)}: ${safeModelText(record.text, 2000)}`
      })].join('\n')
    }),
    execute: async (args, exec) => {
      const file = await requireFs(host).readVersioned(args.path, exec.signal)
      const all = file.content.split('\n')
      const offset = Math.max(1, args.offset ?? 1)
      const limit = Math.max(1, Math.min(2000, args.limit ?? 2000))
      return {
        path: file.path,
        revision: file.revision,
        offset,
        totalLines: all.length,
        lines: all.slice(offset - 1, offset - 1 + limit).map((text, index) => ({ number: offset + index, text })),
      }
    },
    isConcurrencySafe: () => true,
  })

  const write = defineTool({
    name: 'obsidian_write',
    description: 'Create or atomically replace a UTF-8 vault file. Supply if_match when replacing content previously read.',
    parameters: {
      path: { type: 'string', required: true },
      content: { type: 'string', required: true },
      if_match: { type: 'string', description: 'Expected SHA-256 revision.' },
    },
    output: openObjectOutput(fileSummary('Written')),
    execute: async (args, exec) => fileResult(await requireFs(host).write(args.path, args.content, { ifMatch: args.if_match, signal: exec.signal })),
  })

  const edit = defineTool({
    name: 'obsidian_edit',
    description: 'Conflict-safe literal replacement. old_string must be unique unless replace_all is true.',
    parameters: {
      path: { type: 'string', required: true },
      old_string: { type: 'string', required: true },
      new_string: { type: 'string', required: true },
      replace_all: { type: 'boolean' },
      if_match: { type: 'string' },
    },
    output: openObjectOutput((value) => `Edited ${safeModelText(value.path)}: ${String(value.count)} replacement(s), revision ${safeModelText(value.revision)}`),
    execute: async (args, exec) => {
      const result = await requireFs(host).editLiteral(args.path, args.old_string, args.new_string, args.replace_all ?? false, { ifMatch: args.if_match, signal: exec.signal })
      return { path: result.file.path, revision: result.file.revision, count: result.count, size: result.file.size, mtime: result.file.mtime }
    },
  })

  const append = defineTool({
    name: 'obsidian_append',
    description: 'Atomically append UTF-8 text, serialized per path. Supply if_match to reject a stale append.',
    parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true }, if_match: { type: 'string' } },
    output: openObjectOutput(fileSummary('Appended to')),
    execute: async (args, exec) => fileResult(await requireFs(host).append(args.path, args.content, { ifMatch: args.if_match, signal: exec.signal })),
  })

  const mkdir = defineTool({
    name: 'obsidian_mkdir',
    description: 'Create a vault folder and missing parents.',
    parameters: { path: { type: 'string', required: true } },
    output: openObjectOutput((value) => `Created folder ${safeModelText(value.path)}`),
    execute: async (args, exec) => ({ path: (await requireFs(host).mkdir(args.path, exec.signal)).path, created: true }),
  })

  const copy = defineTool({
    name: 'obsidian_copy',
    description: 'Copy a file or folder inside the vault. The destination is never overwritten without a matching revision.',
    parameters: { source: { type: 'string', required: true }, target: { type: 'string', required: true }, if_match: { type: 'string' } },
    output: openObjectOutput((value) => `Copied to ${safeModelText(value.path)}`),
    execute: async (args, exec) => entryResult(await requireFs(host).copy(args.source, args.target, { ifMatch: args.if_match, signal: exec.signal })),
  })

  const move = defineTool({
    name: 'obsidian_move',
    description: 'Move or rename a vault file or folder with destination conflict protection.',
    parameters: { source: { type: 'string', required: true }, target: { type: 'string', required: true }, if_match: { type: 'string' } },
    output: openObjectOutput((value) => `Moved to ${safeModelText(value.path)}`),
    execute: async (args, exec) => entryResult(await requireFs(host).move(args.source, args.target, { ifMatch: args.if_match, signal: exec.signal })),
  })

  const remove = defineTool({
    name: 'obsidian_delete',
    description: 'Move a vault path to internal trash by default. permanent=true performs irreversible deletion and requires approval.',
    parameters: { path: { type: 'string', required: true }, permanent: { type: 'boolean' }, if_match: { type: 'string' } },
    output: openObjectOutput((value) => `${value.permanent ? 'Permanently deleted' : 'Trashed'} ${safeModelText(value.path)}`),
    execute: async (args, exec) => {
      await requireFs(host).delete(args.path, { permanent: args.permanent ?? false, ifMatch: args.if_match, signal: exec.signal })
      return { path: args.path, deleted: true, permanent: args.permanent ?? false }
    },
  })

  return [status, list, stat, read, write, edit, append, mkdir, copy, move, remove]
}

function entryResult(entry: { path: string; kind: 'file' | 'folder'; size: number; mtime: number; revision?: string }): Record<string, JsonValue> {
  return compact({ path: entry.path, kind: entry.kind, size: entry.size, mtime: entry.mtime, revision: entry.revision })
}
function fileResult(file: { path: string; size: number; mtime: number; revision: string }): Record<string, JsonValue> {
  return { path: file.path, size: file.size, mtime: file.mtime, revision: file.revision }
}
function fileSummary(verb: string): (value: Record<string, JsonValue>) => string {
  return (value) => `${verb} ${safeModelText(value.path)} (${String(value.size)} bytes), revision ${safeModelText(value.revision)}`
}
