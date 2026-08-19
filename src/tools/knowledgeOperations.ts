import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { BridgeError } from '../bridge/bridge.ts'
import { normalizeVaultPath } from '../vault/vaultPaths.ts'
import type { ToolHost } from './context.ts'
import { requireFs } from './context.ts'

export interface SearchInput {
  query: string
  mode: 'literal' | 'regex' | 'path'
  folder?: string
  extensions?: string[]
  tags?: string[]
  properties?: Record<string, string | number | boolean>
  cursor?: string
  limit?: number
}

export function createKnowledgeOperations(host: ToolHost) {
  return {
    async search(input: SearchInput, signal: AbortSignal) {
      const folder = input.folder ? normalizeVaultPath(input.folder) : undefined
      if (host.config().mode !== 'fs') {
        try {
          const online = await host.bridge().searchIndexed({ ...input, folder }, signal)
          return {
            hits: online.results.map((hit) => ({ path: hit.path, lineNumber: hit.lineNumber ?? 0, line: hit.snippet ?? '' })),
            nextCursor: online.nextCursor,
          }
        } catch (error) {
          if (!(host.config().mode === 'auto' && error instanceof BridgeError && (error.code === 'UNREACHABLE' || error.code === 'TIMEOUT'))) throw error
        }
      }
      return requireFs(host).search({ ...input, folder, signal })
    },
    async metadata(notePath: string, signal: AbortSignal): Promise<JsonValue> {
      return host.bridge().metadata(normalizeVaultPath(notePath), signal) as Promise<JsonValue>
    },
    async updateFrontmatter(notePath: string, patch: Record<string, unknown>, remove: string[] | undefined, ifMatch: string | undefined, signal: AbortSignal): Promise<JsonValue> {
      return host.bridge().updateFrontmatter({ path: normalizeVaultPath(notePath), patch, remove, ifMatch }, signal) as Promise<JsonValue>
    },
    async resolveLink(link: string, sourcePath: string | undefined, signal: AbortSignal) {
      return host.bridge().resolveLink({ link, sourcePath: sourcePath ? normalizeVaultPath(sourcePath) : undefined }, signal)
    },
    async links(notePath: string, signal: AbortSignal): Promise<JsonValue> {
      return host.bridge().links(normalizeVaultPath(notePath), signal) as unknown as Promise<JsonValue>
    },
  }
}
