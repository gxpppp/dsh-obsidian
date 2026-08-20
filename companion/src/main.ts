import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { extname } from 'node:path'
import {
  App,
  apiVersion,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from 'obsidian'
import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  canonicalVaultIdentity,
  companionEndpoint,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope,
} from '../../src/bridge/protocol.ts'

interface BridgeData { token?: string; enabled?: boolean; ipcName?: string }
interface BridgeSettings { token: string; enabled: boolean; ipcName: string }
interface CommandsFace {
  executeCommandById(id: string): unknown
  commands: Record<string, { id: string; name: string }>
}
interface EditorSnapshot {
  channel: 'companion'
  path: string
  mode: 'source' | 'preview' | 'other'
  content?: string
  revision: string
  selection: { from: number; to: number; text: string } | null
  cursor: { line: number; ch: number; offset: number } | null
  openTabs: string[]
}

const PLUGIN_VERSION = '0.3.0'
const DEFAULT_SETTINGS: BridgeSettings = { token: '', enabled: true, ipcName: '' }
const CAPABILITIES = [
  'editor.state', 'editor.edit', 'editor.open', 'search', 'metadata.get',
  'frontmatter.update', 'links.resolve', 'links.list', 'links.insert',
  'attachments.add', 'commands.list', 'commands.execute', 'notice',
]

class CompanionError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'CompanionError'
  }
}

export default class DshObsidianBridge extends Plugin {
  private bridgeSettings: BridgeSettings = DEFAULT_SETTINGS
  private server: Server | null = null
  private endpoint = ''
  private sockets = new Set<Socket>()

  async onload(): Promise<void> {
    const data = (await this.loadData()) as BridgeData | undefined
    this.bridgeSettings = {
      token: data?.token || randomBytes(32).toString('hex'),
      enabled: data?.enabled ?? true,
      ipcName: data?.ipcName?.trim() ?? '',
    }
    await this.saveData(this.bridgeSettings)
    this.addSettingTab(new BridgeSettingTab(this.app, this))
    if (this.bridgeSettings.enabled) await this.startServer()
  }

  onunload(): void { this.stopServer() }
  getSettings(): Readonly<BridgeSettings> { return this.bridgeSettings }
  getEndpoint(): string { return this.endpoint || this.resolveEndpoint() }

  async updateSettings(patch: Partial<BridgeSettings>): Promise<void> {
    this.bridgeSettings = { ...this.bridgeSettings, ...patch }
    await this.saveData(this.bridgeSettings)
    this.stopServer()
    if (this.bridgeSettings.enabled) await this.startServer()
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter)) throw new CompanionError('UNSUPPORTED', 'The DSH bridge requires a filesystem-backed desktop vault')
    return adapter.getBasePath()
  }

  private resolveEndpoint(): string {
    return companionEndpoint(this.vaultRoot(), this.bridgeSettings.ipcName || undefined)
  }

  private async startServer(): Promise<void> {
    this.endpoint = this.resolveEndpoint()
    if (process.platform !== 'win32' && existsSync(this.endpoint)) await removeStaleUnixSocket(this.endpoint)
    this.server = createServer((socket) => this.accept(socket))
    this.server.on('error', (error) => {
      console.error('[DSH Obsidian Bridge] IPC server error', error)
      new Notice(`[DSH Bridge] IPC error: ${error.message}`)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      this.server!.once('error', onError)
      this.server!.listen(this.endpoint, () => {
        this.server!.off('error', onError)
        resolve()
      })
    })
    console.log(`[DSH Obsidian Bridge] listening on ${this.endpoint}`)
  }

  private stopServer(): void {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server?.close()
    this.server = null
    if (process.platform !== 'win32' && this.endpoint && existsSync(this.endpoint)) {
      try { unlinkSync(this.endpoint) } catch { /* cleaned by the OS or next startup */ }
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    socket.setTimeout(10_000, () => socket.destroy())
    let received = Buffer.alloc(0)
    let handled = false
    socket.on('data', (chunk: Buffer) => {
      if (handled) return
      received = Buffer.concat([received, chunk])
      if (received.byteLength > MAX_MESSAGE_BYTES) {
        handled = true
        this.respond(socket, '', false, undefined, new CompanionError('TOO_LARGE', 'Request exceeds the 1 MiB protocol limit'))
        return
      }
      const newline = received.indexOf(0x0a)
      if (newline < 0) return
      handled = true
      void this.handleLine(received.subarray(0, newline).toString('utf8'), socket)
    })
    socket.once('error', () => undefined)
    socket.once('close', () => this.sockets.delete(socket))
  }

  private async handleLine(line: string, socket: Socket): Promise<void> {
    let request: BridgeRequestEnvelope
    try { request = JSON.parse(line) as BridgeRequestEnvelope } catch {
      this.respond(socket, '', false, undefined, new CompanionError('PROTOCOL_MISMATCH', 'Request is not valid JSON'))
      return
    }
    try {
      this.validateEnvelope(request)
      const data = await this.route(request.method, asRecord(request.params))
      this.respond(socket, request.requestId, true, data)
    } catch (error) {
      this.respond(socket, request.requestId || '', false, undefined, normalizeError(error))
    }
  }

  private validateEnvelope(request: BridgeRequestEnvelope): void {
    if (request.protocolVersion !== BRIDGE_PROTOCOL_VERSION) throw new CompanionError('PROTOCOL_MISMATCH', `Expected protocol ${BRIDGE_PROTOCOL_VERSION}`)
    if (typeof request.requestId !== 'string' || !request.requestId) throw new CompanionError('PROTOCOL_MISMATCH', 'requestId is required')
    if (typeof request.method !== 'string' || !request.method) throw new CompanionError('PROTOCOL_MISMATCH', 'method is required')
    const actual = Buffer.from(typeof request.token === 'string' ? request.token : '', 'utf8')
    const expected = Buffer.from(this.bridgeSettings.token, 'utf8')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new CompanionError('UNAUTHORIZED', 'Invalid companion token')
  }

  private respond(socket: Socket, requestId: string, ok: boolean, data?: unknown, error?: CompanionError): void {
    const response: BridgeResponseEnvelope = ok
      ? { protocolVersion: BRIDGE_PROTOCOL_VERSION, requestId, ok: true, data }
      : { protocolVersion: BRIDGE_PROTOCOL_VERSION, requestId, ok: false, error: { code: error?.code ?? 'INTERNAL', message: error?.message ?? 'Unknown error', details: error?.details } }
    const encoded = `${JSON.stringify(response)}\n`
    if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
      socket.end(`${JSON.stringify({ protocolVersion: BRIDGE_PROTOCOL_VERSION, requestId, ok: false, error: { code: 'TOO_LARGE', message: 'Response exceeds the 1 MiB protocol limit' } })}\n`)
    } else socket.end(encoded)
  }

  private async route(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'hello': return {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        pluginVersion: PLUGIN_VERSION,
        obsidianVersion: apiVersion,
        vault: canonicalVaultIdentity(this.vaultRoot()),
        capabilities: CAPABILITIES,
      }
      case 'editor.state': return this.snapshotEditor(params.includeContent === true)
      case 'editor.edit': return this.applyEditorEdit(params)
      case 'editor.open': return this.openNote(params)
      case 'search': return this.search(params)
      case 'metadata.get': return this.metadata(params)
      case 'frontmatter.update': return this.updateFrontmatter(params)
      case 'links.resolve': return this.resolveLink(params)
      case 'links.list': return this.listLinks(params)
      case 'links.insert': return this.insertLink(params)
      case 'attachments.add': return this.addAttachment(params)
      case 'commands.list': return { commands: this.listCommands() }
      case 'commands.execute': return this.executeCommand(params)
      case 'notice': new Notice(requiredString(params, 'message').slice(0, 4000)); return { shown: true }
      default: throw new CompanionError('UNSUPPORTED', `Unknown companion method: ${method}`)
    }
  }

  private snapshotEditor(includeContent: boolean): EditorSnapshot {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (view === null || view.file === null) return { channel: 'companion', path: '', mode: 'other', content: includeContent ? '' : undefined, revision: sha256(''), selection: null, cursor: null, openTabs: this.openTabs() }
    const content = view.editor.getValue()
    const cm = (view.editor as unknown as { cm?: { state: { doc: { toString(): string; lineAt(offset: number): { number: number; from: number } }; selection: { main: { from: number; to: number; head: number } } } } }).cm
    const shared = { channel: 'companion' as const, path: view.file.path, mode: normalizeMode(view.getMode()), ...(includeContent ? { content } : {}), revision: sha256(content), openTabs: this.openTabs() }
    if (cm === undefined) return { ...shared, selection: null, cursor: null }
    const main = cm.state.selection.main
    if (main.from === main.to) {
      const line = cm.state.doc.lineAt(main.head)
      return { ...shared, selection: null, cursor: { line: line.number, ch: main.head - line.from, offset: main.head } }
    }
    return { ...shared, selection: { from: main.from, to: main.to, text: content.slice(main.from, main.to) }, cursor: null }
  }

  private openTabs(): string[] {
    return this.app.workspace.getLeavesOfType('markdown').map((leaf) => (leaf.view as MarkdownView).file?.path).filter((value): value is string => Boolean(value))
  }

  private applyEditorEdit(params: Record<string, unknown>): { revision: string } {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (view === null || view.file === null) throw new CompanionError('NOT_FOUND', 'No active Markdown editor')
    const path = requiredPath(params, 'path')
    if (view.file.path !== path) throw new CompanionError('CONFLICT', `Active note changed to ${view.file.path}`)
    const content = view.editor.getValue()
    const revision = requiredString(params, 'revision')
    if (sha256(content) !== revision) throw new CompanionError('CONFLICT', 'The active note changed after it was read')
    const from = requiredInteger(params, 'from', 0, content.length)
    const to = requiredInteger(params, 'to', from, content.length)
    const expectedText = requiredString(params, 'expectedText', true)
    if (content.slice(from, to) !== expectedText) throw new CompanionError('CONFLICT', 'The selected text no longer matches')
    const text = requiredString(params, 'text', true)
    const cm = (view.editor as unknown as { cm?: { dispatch(input: { changes: { from: number; to: number; insert: string }; selection: { anchor: number; head: number } }): void } }).cm
    if (cm !== undefined) cm.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length, head: from + text.length } })
    else {
      view.editor.replaceRange(text, offsetToPos(content, from), offsetToPos(content, to))
      view.editor.setCursor(offsetToPos(`${content.slice(0, from)}${text}${content.slice(to)}`, from + text.length))
    }
    return { revision: sha256(`${content.slice(0, from)}${text}${content.slice(to)}`) }
  }

  private async openNote(params: Record<string, unknown>): Promise<{ opened: true }> {
    const file = this.requireFile(requiredPath(params, 'path'))
    const leaf = this.app.workspace.getLeaf(false)
    await leaf.openFile(file)
    const line = optionalInteger(params.line)
    if (line !== undefined && line >= 1) {
      setTimeout(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView)
        if (view?.file?.path === file.path) view.editor.setCursor({ line: line - 1, ch: 0 })
      }, 100)
    }
    return { opened: true }
  }

  private async search(params: Record<string, unknown>): Promise<{ results: Array<{ path: string; lineNumber: number; snippet: string }>; nextCursor?: string }> {
    const query = requiredString(params, 'query', true)
    const mode = params.mode === 'regex' || params.mode === 'path' ? params.mode : 'literal'
    const limit = Math.max(1, Math.min(200, optionalInteger(params.limit) ?? 50))
    const start = decodeCursor(typeof params.cursor === 'string' ? params.cursor : undefined)
    const folder = typeof params.folder === 'string' ? requiredPath(params, 'folder') : ''
    const extensions = Array.isArray(params.extensions) ? params.extensions.filter((v): v is string => typeof v === 'string').map((v) => v.replace(/^\./, '').toLowerCase()) : undefined
    const tags = Array.isArray(params.tags) ? params.tags.filter((v): v is string => typeof v === 'string').map((v) => v.replace(/^#/, '')) : []
    const properties = params.properties === undefined ? {} : asRecord(params.properties)
    let regex: RegExp | undefined
    if (mode === 'regex') {
      if (/\(\?<=[^)]*\)|\(\?<!|\\\d/.test(query)) throw new CompanionError('INVALID_PATH', 'Regex lookbehind and backreferences are not supported')
      try { regex = new RegExp(query, 'i') } catch { throw new CompanionError('INVALID_PATH', 'Invalid regular expression') }
    }
    const files = this.app.vault.getFiles().filter((file) => (!folder || file.path.startsWith(`${folder}/`)) && (!extensions || extensions.includes(file.extension.toLowerCase())))
    const results: Array<{ path: string; lineNumber: number; snippet: string }> = []
    let cursor = start
    for (; cursor < files.length && results.length < limit; cursor++) {
      const file = files[cursor]
      if (tags.length > 0 || Object.keys(properties).length > 0) {
        const cache = this.app.metadataCache.getFileCache(file)
        const fileTags = new Set([...(cache?.tags?.map((tag) => tag.tag.replace(/^#/, '')) ?? []), ...frontmatterTags(cache?.frontmatter)])
        if (!tags.every((tag) => fileTags.has(tag))) continue
        if (!Object.entries(properties).every(([key, value]) => cache?.frontmatter?.[key] === value)) continue
      }
      if (mode === 'path') {
        if (file.path.toLowerCase().includes(query.toLowerCase())) results.push({ path: file.path, lineNumber: 0, snippet: file.path })
        continue
      }
      if (file.stat.size > 5 * 1024 * 1024 || !['md', 'markdown', 'txt', 'canvas', 'json'].includes(file.extension.toLowerCase())) continue
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
      const content = activeView?.file?.path === file.path
        ? activeView.editor.getValue()
        : await this.app.vault.cachedRead(file)
      const lines = content.split(/\n/)
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber].replace(/\r$/, '')
        if (regex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase())) { results.push({ path: file.path, lineNumber: lineNumber + 1, snippet: line.slice(0, 1000) }); break }
      }
    }
    return { results, nextCursor: cursor < files.length ? encodeCursor(cursor) : undefined }
  }

  private async metadata(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const file = this.requireFile(requiredPath(params, 'path'))
    const content = await this.app.vault.cachedRead(file)
    const cache = this.app.metadataCache.getFileCache(file)
    return {
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      revision: sha256(content),
      frontmatter: cache?.frontmatter ?? null,
      tags: cache?.tags?.map((tag) => tag.tag) ?? [],
      headings: cache?.headings?.map((heading) => ({ heading: heading.heading, level: heading.level })) ?? [],
      blocks: Object.keys(cache?.blocks ?? {}),
      links: cache?.links?.map((link) => link.link) ?? [],
      embeds: cache?.embeds?.map((embed) => embed.link) ?? [],
    }
  }

  private async updateFrontmatter(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const file = this.requireFile(requiredPath(params, 'path'))
    const before = await this.app.vault.cachedRead(file)
    const ifMatch = typeof params.ifMatch === 'string' ? params.ifMatch : undefined
    if (ifMatch && sha256(before) !== ifMatch) throw new CompanionError('CONFLICT', 'The note changed after it was read')
    const patch = asRecord(params.patch)
    const remove = Array.isArray(params.remove) ? params.remove.filter((v): v is string => typeof v === 'string') : []
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(patch)) frontmatter[key] = value
      for (const key of remove) delete frontmatter[key]
    })
    return this.metadata({ path: file.path })
  }

  private resolveLink(params: Record<string, unknown>): { path?: string; exists: boolean } {
    const link = requiredString(params, 'link')
    const sourcePath = typeof params.sourcePath === 'string' ? params.sourcePath : ''
    const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath)
    return file ? { path: file.path, exists: true } : { exists: false }
  }

  private listLinks(params: Record<string, unknown>): Record<string, unknown> {
    const file = this.requireFile(requiredPath(params, 'path'))
    const cache = this.app.metadataCache.getFileCache(file)
    const outgoing = [...(cache?.links ?? []).map((link) => ({ link: link.link, display: link.displayText, embed: false })), ...(cache?.embeds ?? []).map((link) => ({ link: link.link, display: link.displayText, embed: true }))].map((link) => ({ ...link, target: this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path }))
    const backlinks = Object.entries(this.app.metadataCache.resolvedLinks).filter(([, targets]) => targets[file.path] !== undefined).map(([source]) => source)
    const unresolved = Object.keys(this.app.metadataCache.unresolvedLinks[file.path] ?? {})
    return { path: file.path, outgoing, backlinks, unresolved }
  }

  private async insertLink(params: Record<string, unknown>): Promise<{ link: string; revision: string }> {
    const source = this.requireFile(requiredPath(params, 'path'))
    const target = this.requireFile(requiredPath(params, 'target'))
    const before = await this.app.vault.cachedRead(source)
    if (typeof params.ifMatch === 'string' && sha256(before) !== params.ifMatch) throw new CompanionError('CONFLICT', 'The source note changed after it was read')
    const generated = this.app.fileManager.generateMarkdownLink(target, source.path, undefined, typeof params.display === 'string' ? params.display : undefined)
    const link = params.embed === true ? `!${generated}` : generated
    const position = optionalInteger(params.position) ?? before.length
    if (position < 0 || position > before.length) throw new CompanionError('INVALID_PATH', 'Link position is outside the note')
    const after = `${before.slice(0, position)}${link}${before.slice(position)}`
    await this.app.vault.modify(source, after)
    return { link, revision: sha256(after) }
  }

  private addAttachment(params: Record<string, unknown>): { path: string; mediaType?: string; bytes: number; link: string } {
    const file = this.requireFile(requiredPath(params, 'path'))
    const sourcePath = typeof params.sourcePath === 'string' ? requiredPath(params, 'sourcePath') : ''
    const link = this.app.fileManager.generateMarkdownLink(file, sourcePath)
    return { path: file.path, mediaType: mimeFromName(file.name), bytes: file.stat.size, link }
  }

  private listCommands(): Array<{ id: string; name: string }> {
    const commands = (this.app as unknown as { commands: CommandsFace }).commands.commands
    return Object.values(commands).map((command) => ({ id: command.id, name: command.name })).sort((a, b) => a.name.localeCompare(b.name))
  }

  private executeCommand(params: Record<string, unknown>): { executed: true } {
    const id = requiredString(params, 'id')
    const face = (this.app as unknown as { commands: CommandsFace }).commands
    if (face.commands[id] === undefined) throw new CompanionError('NOT_FOUND', `Unknown Obsidian command: ${id}`)
    if (face.executeCommandById(id) === false) throw new CompanionError('INTERNAL', `Obsidian command failed: ${id}`)
    return { executed: true }
  }

  private requireFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) throw new CompanionError('NOT_FOUND', `Vault file not found: ${path}`)
    return file
  }
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DshObsidianBridge) { super(app, plugin) }
  display(): void {
    const { containerEl } = this
    containerEl.empty()
    new Setting(containerEl).setName('DSH Obsidian Bridge').setDesc(`Local IPC endpoint: ${this.plugin.getEndpoint()}`)
    new Setting(containerEl).setName('Enabled').addToggle((toggle) => toggle.setValue(this.plugin.getSettings().enabled).onChange((enabled) => this.plugin.updateSettings({ enabled })))
    new Setting(containerEl).setName('IPC name').setDesc('Optional override. Letters, numbers, dot, underscore and dash only.').addText((text) => text.setValue(this.plugin.getSettings().ipcName).onChange(async (ipcName) => {
      if (ipcName === '' || /^[A-Za-z0-9._-]{1,80}$/.test(ipcName)) await this.plugin.updateSettings({ ipcName })
    }))
    new Setting(containerEl).setName('Token').setDesc('Stored locally and read automatically by the DSH plugin when both use the same vault.').addText((text) => { text.inputEl.type = 'password'; text.setValue(this.plugin.getSettings().token) })
    new Setting(containerEl).setName('Regenerate token').addButton((button) => button.setButtonText('Regenerate').onClick(async () => { await this.plugin.updateSettings({ token: randomBytes(32).toString('hex') }); this.display() }))
  }
}

async function removeStaleUnixSocket(endpoint: string): Promise<void> {
  const state = await new Promise<'active' | 'stale'>((resolve) => {
    const probe = createConnection(endpoint)
    probe.once('connect', () => { probe.destroy(); resolve('active') })
    probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'stale' : 'active'))
  })
  if (state === 'active') throw new CompanionError('CONFLICT', `Another companion is already using ${endpoint}`)
  if (existsSync(endpoint)) unlinkSync(endpoint)
}
function normalizeError(error: unknown): CompanionError {
  if (error instanceof CompanionError) return error
  return new CompanionError('INTERNAL', error instanceof Error ? error.message : String(error))
}
function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CompanionError('PROTOCOL_MISMATCH', 'params must be an object')
  return value as Record<string, unknown>
}
function requiredString(params: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = params[key]
  if (typeof value !== 'string' || (!allowEmpty && value === '')) throw new CompanionError('INVALID_PATH', `${key} must be a ${allowEmpty ? '' : 'non-empty '}string`)
  return value
}
function requiredPath(params: Record<string, unknown>, key: string): string {
  const value = requiredString(params, key)
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) throw new CompanionError('INVALID_PATH', `${key} must be a safe vault-relative path`)
  return normalizePath(value)
}
function requiredInteger(params: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = params[key]
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new CompanionError('INVALID_PATH', `${key} must be an integer from ${min} to ${max}`)
  return value as number
}
function optionalInteger(value: unknown): number | undefined { return Number.isSafeInteger(value) ? value as number : undefined }
function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function normalizeMode(value: string): 'source' | 'preview' | 'other' { return value === 'source' || value === 'preview' ? value : 'other' }
function offsetToPos(content: string, offset: number): { line: number; ch: number } {
  const before = content.slice(0, Math.max(0, Math.min(offset, content.length)))
  const lines = before.split('\n')
  return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 }
}
function encodeCursor(value: number): string { return Buffer.from(String(value)).toString('base64url') }
function decodeCursor(value?: string): number { const parsed = value ? Number(Buffer.from(value, 'base64url').toString()) : 0; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0 }
function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
  const raw = frontmatter?.tags ?? frontmatter?.tag
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string').map((value) => value.replace(/^#/, ''))
  if (typeof raw === 'string') return raw.split(/[ ,]+/).filter(Boolean).map((value) => value.replace(/^#/, ''))
  return []
}
function mimeFromName(name: string): string | undefined {
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' } as Record<string, string>)[extname(name).toLowerCase()]
}
