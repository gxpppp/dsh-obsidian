/**
 * DSH Obsidian Bridge — the editor-fidelity channel of the dsh-obsidian DSH
 * plugin (port of Claudian's editor integration: active note + CM6 selection
 * capture, inline edit application, open-to-line, command execution).
 *
 * Runs inside Obsidian (Electron renderer) and serves a small HTTP API on
 * 127.0.0.1 with bearer-token auth. Only the local machine can reach it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian'

interface BridgeData {
  token?: string
  port?: number
  enabled?: boolean
}

/** Loose command registry face (App.commands typing varies across versions). */
interface CommandsFace {
  executeCommandById(id: string): unknown
  commands: Record<string, { id: string; name: string }>
}

interface BridgeSettings {
  token: string
  port: number
  enabled: boolean
}

const DEFAULT_SETTINGS: BridgeSettings = { token: '', port: 34567, enabled: true }

function randomToken(): string {
  const bytes = new Uint8Array(24)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readBody(req: IncomingMessage, limit = 1 << 20): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

interface EditorSnapshot {
  path: string
  mode: string
  content: string
  selection: { from: number; to: number; text: string } | null
  cursor: { line: number; ch: number } | null
}

export default class DshObsidianBridge extends Plugin {
  private bridgeSettings: BridgeSettings = DEFAULT_SETTINGS
  private server: ReturnType<typeof createServer> | null = null

  async onload(): Promise<void> {
    const data = (await this.loadData()) as BridgeData | undefined
    this.bridgeSettings = {
      token: data?.token || randomToken(),
      port: data?.port ?? DEFAULT_SETTINGS.port,
      enabled: data?.enabled ?? DEFAULT_SETTINGS.enabled,
    }
    await this.saveData(this.bridgeSettings)

    this.addSettingTab(new BridgeSettingTab(this.app, this))

    if (this.bridgeSettings.enabled) {
      this.startServer()
    }
  }

  onunload(): void {
    this.stopServer()
  }

  getSettings(): BridgeSettings {
    return this.bridgeSettings
  }

  async updateSettings(patch: Partial<BridgeSettings>): Promise<void> {
    this.bridgeSettings = { ...this.bridgeSettings, ...patch }
    await this.saveData(this.bridgeSettings)
    this.stopServer()
    if (this.bridgeSettings.enabled) this.startServer()
  }

  private startServer(): void {
    const port = this.bridgeSettings.port
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    })
    this.server.on('error', (error) => {
      new Notice(`[DSH Bridge] server error: ${error.message}`)
      this.server = null
    })
    this.server.listen(port, '127.0.0.1', () => {
      console.log(`[DSH Bridge] listening on http://127.0.0.1:${port}`)
    })
  }

  private stopServer(): void {
    if (this.server !== null) {
      this.server.close()
      this.server = null
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    return header === `Bearer ${this.bridgeSettings.token}`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    if (req.method === 'GET' && path === '/api/health') {
      json(res, 200, { ok: true, detail: `vault: ${this.app.vault.getName()}` })
      return
    }
    if (req.method === 'GET' && path === '/api/state') {
      json(res, 200, this.snapshotEditor())
      return
    }
    if (req.method === 'GET' && path === '/api/commands') {
      json(res, 200, { commands: this.listCommands(200) })
      return
    }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      if (path === '/api/edit') {
        json(res, 200, this.applyEdit(body))
        return
      }
      if (path === '/api/open') {
        await this.openNote(body)
        json(res, 200, { ok: true })
        return
      }
      if (path === '/api/notice') {
        new Notice(String(body.message ?? ''))
        json(res, 200, { ok: true })
        return
      }
      if (path === '/api/command') {
        const commands = this.app as unknown as { commands: CommandsFace }
        const ok = commands.commands.executeCommandById(String(body.id ?? ''))
        json(res, 200, { ok: ok !== false })
        return
      }
      if (path === '/api/search') {
        json(res, 200, { results: await this.searchNotes(String(body.query ?? ''), Number(body.limit ?? 20)) })
        return
      }
    }
    json(res, 404, { ok: false, error: 'not found' })
  }

  /** Capture active MarkdownView state: path, mode, content, CM6 selection/cursor. */
  private snapshotEditor(): EditorSnapshot {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (view === null || view.file === null) {
      return { path: '', mode: 'other', content: '', selection: null, cursor: null }
    }
    const editor = view.editor
    const cm = (editor as unknown as { cm?: { state: { doc: { toString(): string; lineAt(offset: number): { number: number; from: number } }; selection: { main: { from: number; to: number; head: number } } } } }).cm
    const content = editor.getValue()
    if (cm === undefined || cm.state === undefined) {
      // Fallback: no CM6 handle; report file without selection.
      return { path: view.file.path, mode: view.getMode(), content, selection: null, cursor: null }
    }
    const main = cm.state.selection.main
    if (main.from === main.to) {
      const lineInfo = cm.state.doc.lineAt(main.head)
      return {
        path: view.file.path,
        mode: view.getMode(),
        content,
        selection: null,
        cursor: { line: lineInfo.number, ch: main.head - lineInfo.from },
      }
    }
    return {
      path: view.file.path,
      mode: view.getMode(),
      content,
      selection: { from: main.from, to: main.to, text: cm.state.doc.toString().slice(main.from, main.to) },
      cursor: null,
    }
  }

  /** Apply a replacement at character offsets in the active editor. */
  private applyEdit(body: Record<string, unknown>): { ok: boolean; error?: string } {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (view === null || view.file === null) return { ok: false, error: 'no active markdown view' }
    const expected = String(body.path ?? '')
    if (expected !== '' && expected !== view.file.path) {
      return { ok: false, error: `active note is ${view.file.path}, not ${expected}` }
    }
    const from = Number(body.from)
    const to = Number(body.to)
    const text = String(body.text ?? '')
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
      return { ok: false, error: 'invalid from/to offsets' }
    }
    const cm = (view.editor as unknown as { cm?: { dispatch(changes: { changes: { from: number; to: number; insert: string }; selection: { anchor: number; head: number } }): void } }).cm
    if (cm !== undefined && typeof cm.dispatch === 'function') {
      // Move the cursor to the end of the inserted text (Claudian inline-edit
      // semantics); a plain changes-only dispatch leaves the cursor behind.
      cm.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length, head: from + text.length },
      })
    } else {
      const fromPos = this.offsetToPos(view.editor.getValue(), from)
      const toPos = this.offsetToPos(view.editor.getValue(), to)
      view.editor.replaceRange(text, fromPos, toPos)
      view.editor.setCursor(this.offsetToPos(view.editor.getValue(), from + text.length))
    }
    return { ok: true }
  }

  private offsetToPos(content: string, offset: number): { line: number; ch: number } {
    const lines = content.split('\n')
    let remaining = Math.max(0, Math.min(offset, content.length))
    for (let i = 0; i < lines.length; i++) {
      if (remaining <= lines[i].length) return { line: i, ch: remaining }
      remaining -= lines[i].length + 1
    }
    return { line: Math.max(0, lines.length - 1), ch: 0 }
  }

  private async openNote(body: Record<string, unknown>): Promise<void> {
    const path = String(body.path ?? '')
    const line = Number(body.line)
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) {
      throw new Error(`note not found: ${path}`)
    }
    const leaf = this.app.workspace.getLeaf(false)
    await leaf.openFile(file)
    if (Number.isFinite(line) && line >= 1) {
      setTimeout(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView)
        if (view !== null && view.file?.path === path) {
          view.editor.setCursor({ line: Math.max(0, line - 1), ch: 0 })
        }
      }, 150)
    }
  }

  private listCommands(limit: number): Array<{ id: string; name: string }> {
    const out: Array<{ id: string; name: string }> = []
    const registry = (this.app as unknown as { commands: CommandsFace }).commands.commands
    // Obsidian's command registry is a plain Record (object), not a Map.
    for (const id of Object.keys(registry)) {
      const command = registry[id]
      if (command === undefined) continue
      out.push({ id: command.id, name: command.name })
      if (out.length >= limit) break
    }
    return out
  }

  /** Bounded full-text scan over markdown files (index-free; caps files and bytes). */
  private async searchNotes(query: string, limit: number): Promise<Array<{ path: string; snippet?: string }>> {
    const needle = query.toLowerCase()
    const results: Array<{ path: string; snippet?: string }> = []
    const files = this.app.vault.getMarkdownFiles()
    const cap = Math.min(files.length, 2000)
    for (let i = 0; i < cap && results.length < limit; i++) {
      const file = files[i]
      try {
        const content = await this.app.vault.cachedRead(file)
        if (content.length > 2_000_000) continue
        const lines = content.split('\n')
        for (let j = 0; j < lines.length && results.length < limit; j++) {
          const line = lines[j]
          if (line.toLowerCase().includes(needle)) {
            results.push({ path: file.path, snippet: line.slice(0, 300) })
            break
          }
        }
      } catch {
        // unreadable: skip
      }
    }
    return results
  }
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DshObsidianBridge) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void plugin
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    new Setting(containerEl).setName('DSH Obsidian Bridge').setDesc('本地桥接服务：仅供 dsh-obsidian 插件使用（127.0.0.1 + token 鉴权）。')
    new Setting(containerEl)
      .setName('Enabled')
      .addToggle((toggle) => toggle.setValue(this.plugin.getSettings().enabled).onChange(async (value) => {
        await this.plugin.updateSettings({ enabled: value })
      }))
    new Setting(containerEl)
      .setName('Port')
      .addText((text) => text.setValue(String(this.plugin.getSettings().port)).onChange(async (value) => {
        const port = Number(value)
        if (Number.isFinite(port) && port > 0 && port < 65536) {
          await this.plugin.updateSettings({ port })
        }
      }))
    new Setting(containerEl)
      .setName('Token')
      .setDesc('把此 token 填入 dsh-obsidian 插件的 Companion Token 设置项。')
      .addText((text) => {
        text.inputEl.type = 'password'
        text.setValue(this.plugin.getSettings().token)
      })
    new Setting(containerEl)
      .setName('Regenerate token')
      .addButton((button) => button.setButtonText('Regenerate').onClick(async () => {
        await this.plugin.updateSettings({ token: randomToken() })
        this.display()
      }))
  }
}
