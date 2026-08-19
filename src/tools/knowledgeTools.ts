import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolHost } from './context.ts'
import { jsonObject, jsonOutput, openObjectOutput, safeModelText } from './helpers.ts'
import { createKnowledgeOperations } from './knowledgeOperations.ts'

export function registerKnowledgeTools(host: ToolHost): ToolDefinition[] {
  const operations = createKnowledgeOperations(host)

  const search = defineTool({
    name: 'obsidian_search',
    description: 'Search vault text, safe regular expressions, or paths with filters, cursor pagination, and hard limits.',
    parameters: {
      query: { type: 'string', required: true }, mode: { type: 'string', enum: ['literal', 'regex', 'path'] },
      folder: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } }, properties: { type: 'json' },
      cursor: { type: 'string' }, limit: { type: 'number' },
    },
    output: openObjectOutput((value) => {
      const hits = Array.isArray(value.hits) ? value.hits : []
      return hits.length ? hits.map((hit) => {
        const record = hit as Record<string, unknown>
        return [safeModelText(record.path), ':', String(record.lineNumber), ': ', safeModelText(record.line, 1000)].join('')
      }).join('\n') : '(no matches)'
    }),
    execute: async (args, exec) => {
      const page = await operations.search({
        query: cleanText(args.query, 2000, true), mode: args.mode ?? 'literal',
        folder: args.folder ? cleanPathText(args.folder) : undefined,
        extensions: args.extensions?.map((value) => cleanToken(value, 20)),
        tags: args.tags?.map((value) => cleanText(value, 100)),
        properties: scalarProperties(jsonObject(args.properties)), cursor: args.cursor, limit: args.limit,
      }, exec.signal)
      return {
        hits: page.hits.map((hit) => ({ path: hit.path, lineNumber: hit.lineNumber, line: hit.line })),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }
    },
    isConcurrencySafe: () => true,
  })

  const metadata = defineTool({
    name: 'obsidian_metadata',
    description: 'Read complete Obsidian metadata: frontmatter, tags, headings, blocks, links, embeds, file facts, and revision. Requires companion.',
    parameters: { path: { type: 'string', required: true } },
    output: jsonOutput(),
    execute: async (args, exec) => operations.metadata(cleanPathText(args.path), exec.signal),
    isConcurrencySafe: () => true,
  })

  const frontmatter = defineTool({
    name: 'obsidian_frontmatter_update',
    description: 'Merge and remove frontmatter properties through Obsidian processFrontMatter with revision protection. Requires companion.',
    parameters: { path: { type: 'string', required: true }, patch: { type: 'json', required: true }, remove: { type: 'array', items: { type: 'string' } }, if_match: { type: 'string' } },
    output: jsonOutput(),
    execute: async (args, exec) => operations.updateFrontmatter(cleanPathText(args.path), checkedProperties(jsonObject(args.patch)), args.remove?.map(checkedPropertyKey), checkedRevision(args.if_match), exec.signal),
  })

  const resolve = defineTool({
    name: 'obsidian_link_resolve',
    description: 'Resolve a wikilink or note name through the Obsidian metadata cache. Requires companion.',
    parameters: { link: { type: 'string', required: true }, source_path: { type: 'string' } },
    output: openObjectOutput((value) => value.exists ? ['Resolved to ', safeModelText(value.path)].join('') : '(unresolved link)'),
    execute: async (args, exec) => operations.resolveLink(cleanText(args.link, 1000), args.source_path ? cleanPathText(args.source_path) : undefined, exec.signal),
    isConcurrencySafe: () => true,
  })

  const links = defineTool({
    name: 'obsidian_links',
    description: 'List outgoing links, backlinks, and unresolved links from the Obsidian metadata cache. Requires companion.',
    parameters: { path: { type: 'string', required: true } },
    output: jsonOutput(),
    execute: async (args, exec) => operations.links(cleanPathText(args.path), exec.signal),
    isConcurrencySafe: () => true,
  })

  return [search, metadata, frontmatter, resolve, links]
}

function cleanText(value: string, max: number, allowEmpty = false): string {
  if ((!allowEmpty && value.length === 0) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Text input is invalid')
  return value
}
function cleanPathText(value: string): string { return cleanText(value, 1000) }
function cleanToken(value: string, max: number): string {
  if (value.length === 0 || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Filter token is invalid')
  return value
}
function scalarProperties(value: Record<string, unknown>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    const checked = checkedPropertyKey(key)
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') throw new Error('Property filters must be scalar')
    result[checked] = item
  }
  return result
}
function checkedProperties(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[checkedPropertyKey(key)] = item
  return result
}
function checkedPropertyKey(value: string): string {
  if (!/^[\p{L}\p{N}_ .-]{1,100}$/u.test(value)) throw new Error('Frontmatter property key is invalid')
  return value
}
function checkedRevision(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('if_match must be a SHA-256 revision')
  return value.toLowerCase()
}
