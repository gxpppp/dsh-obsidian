import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { normalizeVaultPath } from '../vault/vaultPaths.ts'
import type { ToolHost } from './context.ts'
import { openObjectOutput, safeModelText } from './helpers.ts'

export function registerLinkInsertTool(host: ToolHost): ToolDefinition[] {
  return [defineTool({
    name: 'obsidian_link_insert',
    description: 'Insert an Obsidian-generated link or embed with revision conflict protection. Requires companion.',
    parameters: {
      path: { type: 'string', required: true },
      target: { type: 'string', required: true },
      display: { type: 'string' },
      embed: { type: 'boolean' },
      position: { type: 'number' },
      if_match: { type: 'string' },
    },
    output: openObjectOutput((value) => ['Inserted link into ', safeModelText(value.path), '; revision ', safeModelText(value.revision)].join('')),
    execute: async (args, exec) => {
      const sourcePath = normalizeVaultPath(args.path)
      const targetPath = normalizeVaultPath(args.target)
      const display = args.display === undefined ? undefined : validateDisplay(args.display)
      const revision = args.if_match === undefined ? undefined : validateRevision(args.if_match)
      const position = args.position === undefined ? undefined : validatePosition(args.position)
      const result = await host.bridge().insertLink({ path: sourcePath, target: targetPath, display, embed: args.embed ?? false, position, ifMatch: revision }, exec.signal)
      return { path: sourcePath, link: result.link, revision: result.revision }
    },
  })]
}

function validateDisplay(value: string): string {
  if (value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Link display text is invalid')
  return value
}
function validateRevision(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('if_match must be a SHA-256 revision')
  return value.toLowerCase()
}
function validatePosition(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('position must be a non-negative integer')
  return value
}
