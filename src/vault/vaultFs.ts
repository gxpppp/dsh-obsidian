import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  assertWithinVault,
  canonicalVaultRoot,
  normalizeVaultFolder,
  normalizeVaultPath,
  resolveVaultPath,
  VaultError,
} from './vaultPaths.ts'

export interface VaultFsOptions {
  maxTextBytes?: number
  maxBinaryBytes?: number
  protectedPaths?: readonly string[]
}

export interface VersionOptions {
  ifMatch?: string
  signal?: AbortSignal
}

export interface VaultFileEntry {
  path: string
  kind: 'file' | 'folder'
  size: number
  mtime: number
  revision?: string
}

export interface VaultVersionedFile {
  path: string
  content: string
  revision: string
  size: number
  mtime: number
}

export interface VaultBinaryFile {
  path: string
  data: Uint8Array
  revision: string
  size: number
  mtime: number
}

export interface VaultSearchOptions {
  query: string
  folder?: string
  mode?: 'literal' | 'regex' | 'path'
  extensions?: string[]
  tags?: string[]
  properties?: Record<string, string | number | boolean>
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export interface VaultSearchHit {
  path: string
  lineNumber: number
  line: string
  revision?: string
}

export interface VaultSearchPage {
  hits: VaultSearchHit[]
  nextCursor?: string
}

export class VaultFs {
  private readonly rootPath: string
  private readonly rootReal: string
  private readonly maxTextBytes: number
  private readonly maxBinaryBytes: number
  private readonly queues = new Map<string, Promise<void>>()
  private readonly protectedPaths: Set<string>

  constructor(private readonly vaultRoot: string, options: VaultFsOptions = {}) {
    this.rootPath = path.resolve(vaultRoot)
    this.rootReal = canonicalVaultRoot(this.rootPath)
    this.maxTextBytes = options.maxTextBytes ?? 5 * 1024 * 1024
    this.maxBinaryBytes = options.maxBinaryBytes ?? 25 * 1024 * 1024
    this.protectedPaths = new Set((options.protectedPaths ?? ['.obsidian', '.trash', '.git', '.claudian']).map((entry) => entry.toLowerCase()))
  }

  get root(): string { return this.rootPath }
  get canonicalRoot(): string { return this.rootReal }

  private checkSignal(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted')
  }

  private guarded(relative: string, allowRoot = false): string {
    if (allowRoot && (relative === '' || relative === '.')) return this.rootReal
    const normalized = normalizeVaultPath(relative)
    const first = normalized.split('/')[0]?.toLowerCase()
    if (first !== undefined && this.protectedPaths.has(first)) {
      throw new VaultError('PROTECTED_PATH', `Protected vault path: ${normalized}`, { path: normalized })
    }
    const lexical = resolveVaultPath(this.rootPath, normalized)
    return assertWithinVault(this.rootPath, lexical)
  }

  private internal(relative: string): string {
    const lexical = path.resolve(this.rootPath, ...relative.split('/'))
    return assertWithinVault(this.rootPath, lexical)
  }

  private async withQueue<T>(relative: string, task: () => Promise<T>): Promise<T> {
    const key = normalizeVaultPath(relative)
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.queues.set(key, current)
    await previous
    try { return await task() } finally {
      release()
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
  }

  private async ensureParent(absFile: string, signal?: AbortSignal): Promise<void> {
    this.checkSignal(signal)
    const parent = path.dirname(absFile)
    const safeParent = assertWithinVault(this.rootPath, parent)
    await fs.mkdir(safeParent, { recursive: true })
    assertWithinVault(this.rootPath, parent)
  }

  private async readBytes(abs: string, max: number, signal?: AbortSignal): Promise<Buffer> {
    this.checkSignal(signal)
    const st = await fs.stat(abs)
    if (st.size > max) throw new VaultError('TOO_LARGE', `File exceeds the configured ${max}-byte limit`, { path: abs })
    const data = await fs.readFile(abs)
    this.checkSignal(signal)
    return data
  }

  private revision(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex')
  }

  private async currentRevision(abs: string): Promise<string | undefined> {
    try {
      const st = await fs.stat(abs)
      if (!st.isFile()) return undefined
      return this.revision(await fs.readFile(abs))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private checkMatch(actual: string | undefined, expected?: string, relative?: string): void {
    if (expected !== undefined && actual !== expected) {
      throw new VaultError('CONFLICT', `Revision conflict for ${relative ?? 'vault path'}`, { path: relative })
    }
  }

  private async destinationState(abs: string, relative: string): Promise<{ exists: boolean; revision?: string }> {
    try {
      const st = await fs.stat(abs)
      if (st.isDirectory()) return { exists: true }
      return { exists: true, revision: await this.currentRevision(abs) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
      throw new VaultError('IO', `Unable to inspect ${relative}`, { path: relative, cause: error })
    }
  }

  async exists(relative: string, signal?: AbortSignal): Promise<boolean> {
    const abs = this.guarded(relative)
    this.checkSignal(signal)
    try { await fs.access(abs); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async read(relative: string, signal?: AbortSignal): Promise<string> {
    return (await this.readVersioned(relative, signal)).content
  }

  async readVersioned(relative: string, signal?: AbortSignal): Promise<VaultVersionedFile> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    try {
      const data = await this.readBytes(abs, this.maxTextBytes, signal)
      const st = await fs.stat(abs)
      return { path: normalized, content: data.toString('utf8'), revision: this.revision(data), size: st.size, mtime: st.mtimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', `Vault path not found: ${normalized}`, { path: normalized, cause: error })
      if (error instanceof VaultError) throw error
      throw new VaultError('IO', `Unable to read ${normalized}`, { path: normalized, cause: error })
    }
  }

  async readBinary(relative: string, signal?: AbortSignal): Promise<VaultBinaryFile> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    try {
      const data = await this.readBytes(abs, this.maxBinaryBytes, signal)
      const st = await fs.stat(abs)
      return { path: normalized, data, revision: this.revision(data), size: st.size, mtime: st.mtimeMs }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted')
      if (error instanceof VaultError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', `Vault path not found: ${normalized}`, { path: normalized, cause: error })
      throw new VaultError('IO', `Unable to read ${normalized}`, { path: normalized, cause: error })
    }
  }

  async stat(relative: string, signal?: AbortSignal): Promise<VaultFileEntry> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    this.checkSignal(signal)
    try {
      const st = await fs.stat(abs)
      const entry: VaultFileEntry = { path: normalized, kind: st.isDirectory() ? 'folder' : 'file', size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs }
      if (entry.kind === 'file' && st.size <= this.maxBinaryBytes) entry.revision = this.revision(await fs.readFile(abs))
      return entry
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', `Vault path not found: ${normalized}`, { path: normalized, cause: error })
      throw new VaultError('IO', `Unable to stat ${normalized}`, { path: normalized, cause: error })
    }
  }

  async write(relative: string, content: string, options: VersionOptions = {}): Promise<VaultVersionedFile> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    const bytes = Buffer.from(content, 'utf8')
    if (bytes.byteLength > this.maxTextBytes) throw new VaultError('TOO_LARGE', `Content exceeds ${this.maxTextBytes} bytes`, { path: normalized })
    return this.withQueue(normalized, async () => {
      this.checkSignal(options.signal)
      const actual = await this.currentRevision(abs)
      this.checkMatch(actual, options.ifMatch, normalized)
      await this.ensureParent(abs, options.signal)
      const temp = path.join(path.dirname(abs), `.dsh-write-${randomUUID()}.tmp`)
      assertWithinVault(this.rootPath, temp)
      try {
        const handle = await fs.open(temp, 'wx')
        try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        assertWithinVault(this.rootPath, temp)
        await fs.rename(temp, abs)
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined)
      }
      return this.readVersioned(normalized, options.signal)
    })
  }

  async writeBinary(relative: string, data: Uint8Array, options: VersionOptions = {}): Promise<VaultBinaryFile> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    const bytes = Buffer.from(data)
    if (bytes.byteLength > this.maxBinaryBytes) throw new VaultError('TOO_LARGE', `Binary content exceeds ${this.maxBinaryBytes} bytes`, { path: normalized })
    return this.withQueue(normalized, async () => {
      this.checkSignal(options.signal)
      this.checkMatch(await this.currentRevision(abs), options.ifMatch, normalized)
      await this.ensureParent(abs, options.signal)
      const temp = path.join(path.dirname(abs), `.dsh-write-${randomUUID()}.tmp`)
      try {
        const handle = await fs.open(temp, 'wx')
        try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        assertWithinVault(this.rootPath, temp)
        await fs.rename(temp, abs)
      } finally { await fs.rm(temp, { force: true }).catch(() => undefined) }
      return this.readBinary(normalized, options.signal)
    })
  }

  async append(relative: string, content: string, options: VersionOptions = {}): Promise<VaultVersionedFile> {
    const normalized = normalizeVaultPath(relative)
    return this.withQueue(normalized, async () => {
      this.checkSignal(options.signal)
      const abs = this.guarded(normalized)
      let current = ''
      let actual: string | undefined
      try {
        const versioned = await this.readVersioned(normalized, options.signal)
        current = versioned.content
        actual = versioned.revision
      } catch (error) {
        if (!(error instanceof VaultError) || error.code !== 'NOT_FOUND') throw error
      }
      this.checkMatch(actual, options.ifMatch, normalized)
      return this.writeUnlocked(normalized, abs, current + content, options.signal)
    })
  }

  private async writeUnlocked(relative: string, abs: string, content: string, signal?: AbortSignal): Promise<VaultVersionedFile> {
    const bytes = Buffer.from(content, 'utf8')
    if (bytes.byteLength > this.maxTextBytes) throw new VaultError('TOO_LARGE', `Content exceeds ${this.maxTextBytes} bytes`, { path: relative })
    await this.ensureParent(abs, signal)
    const temp = path.join(path.dirname(abs), `.dsh-write-${randomUUID()}.tmp`)
    try {
      const handle = await fs.open(temp, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      assertWithinVault(this.rootPath, temp)
      await fs.rename(temp, abs)
    } finally { await fs.rm(temp, { force: true }).catch(() => undefined) }
    return this.readVersioned(relative, signal)
  }

  async editLiteral(relative: string, oldString: string, newString: string, replaceAll = false, options: VersionOptions = {}): Promise<{ file: VaultVersionedFile; count: number }> {
    const normalized = normalizeVaultPath(relative)
    return this.withQueue(normalized, async () => {
      const versioned = await this.readVersioned(normalized, options.signal)
      this.checkMatch(versioned.revision, options.ifMatch, normalized)
      const count = oldString === '' ? 0 : versioned.content.split(oldString).length - 1
      if (count === 0) throw new VaultError('NOT_FOUND', `old_string not found in ${normalized}`, { path: normalized })
      if (count > 1 && !replaceAll) throw new VaultError('CONFLICT', `old_string matches ${count} times`, { path: normalized })
      const next = replaceAll ? versioned.content.split(oldString).join(newString) : versioned.content.replace(oldString, newString)
      const file = await this.writeUnlocked(normalized, this.guarded(normalized), next, options.signal)
      return { file, count: replaceAll ? count : 1 }
    })
  }

  async mkdir(relative: string, signal?: AbortSignal): Promise<VaultFileEntry> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    await this.ensureParent(path.join(abs, '.keep'), signal)
    await fs.mkdir(abs, { recursive: true })
    assertWithinVault(this.rootPath, abs)
    return this.stat(normalized, signal)
  }

  async copy(source: string, target: string, options: VersionOptions = {}): Promise<VaultFileEntry> {
    const sourcePath = normalizeVaultPath(source)
    const targetPath = normalizeVaultPath(target)
    const srcAbs = this.guarded(sourcePath)
    const dstAbs = this.guarded(targetPath)
    return this.withQueue(targetPath, async () => {
      this.checkSignal(options.signal)
      const sourceStat = await fs.stat(srcAbs)
      const destination = await this.destinationState(dstAbs, targetPath)
      if (destination.exists && options.ifMatch === undefined) throw new VaultError('ALREADY_EXISTS', `Target exists: ${targetPath}`, { path: targetPath })
      this.checkMatch(destination.revision, options.ifMatch, targetPath)
      await this.ensureParent(dstAbs, options.signal)
      if (sourceStat.isDirectory()) await fs.cp(srcAbs, dstAbs, { recursive: true, force: false, errorOnExist: true })
      else if (destination.exists) await fs.copyFile(srcAbs, dstAbs)
      else await fs.copyFile(srcAbs, dstAbs, fsConstants.COPYFILE_EXCL)
      return this.stat(targetPath, options.signal)
    })
  }

  async move(source: string, target: string, options: VersionOptions = {}): Promise<VaultFileEntry> {
    const sourcePath = normalizeVaultPath(source)
    const targetPath = normalizeVaultPath(target)
    const srcAbs = this.guarded(sourcePath)
    const dstAbs = this.guarded(targetPath)
    return this.withQueue(targetPath, async () => {
      this.checkSignal(options.signal)
      try { await fs.stat(srcAbs) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_FOUND', `Vault path not found: ${sourcePath}`, { path: sourcePath, cause: error })
        throw error
      }
      const destination = await this.destinationState(dstAbs, targetPath)
      if (destination.exists && options.ifMatch === undefined) throw new VaultError('ALREADY_EXISTS', `Target exists: ${targetPath}`, { path: targetPath })
      this.checkMatch(destination.revision, options.ifMatch, targetPath)
      await this.ensureParent(dstAbs, options.signal)
      try { await fs.rename(srcAbs, dstAbs) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'ENOTEMPTY') throw new VaultError('ALREADY_EXISTS', `Target exists: ${targetPath}`, { path: targetPath, cause: error })
        throw new VaultError('IO', `Unable to move ${sourcePath}`, { path: sourcePath, cause: error })
      }
      return this.stat(targetPath, options.signal)
    })
  }

  async delete(relative: string, options: VersionOptions & { permanent?: boolean } = {}): Promise<void> {
    const normalized = normalizeVaultPath(relative)
    const abs = this.guarded(normalized)
    await this.withQueue(normalized, async () => {
      this.checkSignal(options.signal)
      this.checkMatch(await this.currentRevision(abs), options.ifMatch, normalized)
      if (options.permanent) {
        await fs.rm(abs, { recursive: true, force: true })
        return
      }
      const trashRoot = this.internal('.trash/dsh-obsidian')
      await fs.mkdir(trashRoot, { recursive: true })
      assertWithinVault(this.rootPath, trashRoot)
      const target = path.join(trashRoot, `${Date.now()}-${randomUUID()}-${path.basename(abs)}`)
      await fs.rename(abs, target)
    })
  }

  async deleteFolder(relative: string, options: VersionOptions & { permanent?: boolean } = {}): Promise<void> {
    return this.delete(relative, options)
  }

  async listFolder(folder: string, signal?: AbortSignal): Promise<VaultFileEntry[]> {
    const normalized = folder === '' || folder === '.' ? '' : normalizeVaultFolder(folder)
    const abs = normalized === '' ? this.rootReal : this.guarded(normalized)
    this.checkSignal(signal)
    let names: string[]
    try { names = await fs.readdir(abs) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new VaultError('IO', `Unable to list ${normalized || '/'}`, { path: normalized, cause: error })
    }
    const out: VaultFileEntry[] = []
    for (const name of names) {
      this.checkSignal(signal)
      if (name.startsWith('.')) continue
      const rel = normalized === '' ? name : `${normalized}/${name}`
      try { out.push(await this.stat(rel, signal)) } catch (error) {
        if (!(error instanceof VaultError) || error.code !== 'NOT_FOUND') throw error
      }
    }
    return out.sort((a, b) => a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'folder' ? -1 : 1)
  }

  async listTree(folder: string, maxEntries = 2000, signal?: AbortSignal): Promise<VaultFileEntry[]> {
    const out: VaultFileEntry[] = []
    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > 32 || out.length >= maxEntries) return
      for (const entry of await this.listFolder(current, signal)) {
        if (out.length >= maxEntries) return
        out.push(entry)
        if (entry.kind === 'folder') await walk(entry.path, depth + 1)
      }
    }
    await walk(folder === '.' ? '' : folder, 0)
    return out
  }

  search(folder: string, pattern: string, limit?: number): Promise<VaultSearchHit[]>
  search(options: VaultSearchOptions): Promise<VaultSearchPage>
  async search(folderOrOptions: string | VaultSearchOptions, pattern?: string, oldLimit = 50): Promise<VaultSearchHit[] | VaultSearchPage> {
    const legacy = typeof folderOrOptions === 'string'
    const options: VaultSearchOptions = legacy
      ? { folder: folderOrOptions, query: pattern ?? '', mode: 'regex', limit: oldLimit }
      : folderOrOptions
    const folder = options.folder ?? ''
    const max = Math.max(1, Math.min(500, options.limit ?? 50))
    const start = decodeCursor(options.cursor)
    const mode = options.mode ?? 'literal'
    let matcher: RegExp | undefined
    if (mode === 'regex') {
      if (/\(\?<=[^)]*\)|\(\?<!|\\\d/.test(options.query)) throw new VaultError('INVALID_PATH', 'Regex uses unsupported lookbehind or backreference syntax')
      try { matcher = new RegExp(options.query, 'i') } catch (error) { throw new VaultError('IO', 'Invalid search regular expression', { cause: error }) }
    }
    const extensions = options.extensions?.map((ext) => ext.toLowerCase().replace(/^\./, ''))
    const hits: VaultSearchHit[] = []
    let index = 0
    const entries = await this.listTree(folder, 2000, options.signal)
    for (const entry of entries) {
      this.checkSignal(options.signal)
      if (entry.kind !== 'file') continue
      if (index++ < start) continue
      if (extensions && !extensions.includes(path.extname(entry.path).slice(1).toLowerCase())) continue
      if (mode === 'path') {
        if (!entry.path.toLowerCase().includes(options.query.toLowerCase())) continue
        hits.push({ path: entry.path, lineNumber: 0, line: entry.path, revision: entry.revision })
      } else {
        let content: string
        try { content = await this.read(entry.path, options.signal) } catch { continue }
        if (options.tags?.length && !options.tags.every((tag) => content.includes(tag.startsWith('#') ? tag : `#${tag}`))) continue
        if (options.properties && !Object.entries(options.properties).every(([key, value]) => new RegExp(`^${escapeRegExp(key)}:\\s*${escapeRegExp(String(value))}\\s*$`, 'mi').test(content))) continue
        const lines = content.split(/\n/)
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          const line = lines[i].replace(/\r$/, '')
          const matches = mode === 'regex' ? matcher!.test(line) : line.toLowerCase().includes(options.query.toLowerCase())
          if (matches) hits.push({ path: entry.path, lineNumber: i + 1, line: line.slice(0, 1000), revision: entry.revision })
          matcher?.lastIndex && (matcher.lastIndex = 0)
        }
      }
      if (hits.length >= max) {
        const nextCursor = encodeCursor(index)
        return legacy ? hits : { hits, nextCursor }
      }
    }
    return legacy ? hits : { hits }
  }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function encodeCursor(value: number): string { return Buffer.from(String(value), 'utf8').toString('base64url') }
function decodeCursor(value?: string): number {
  if (!value) return 0
  const parsed = Number(Buffer.from(value, 'base64url').toString('utf8'))
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
