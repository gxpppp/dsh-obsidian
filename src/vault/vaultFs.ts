/**
 * Vault file layer (port of Claudian's VaultFileAdapter over
 * app.vault.adapter, here over node:fs on the vault directory).
 *
 * Guarantees:
 * - every path is normalized + containment-checked (vaultPaths.ts)
 * - append is serialized through a write queue (no lost updates)
 * - write auto-creates parent folders
 * - deleteFolder fails silently for non-empty/missing folders (Claudian parity)
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  assertWithinVault,
  normalizeVaultFolder,
  normalizeVaultPath,
  resolveVaultPath,
} from './vaultPaths.ts'

export interface VaultFileEntry {
  /** Vault-relative path (forward slashes). */
  path: string
  kind: 'file' | 'folder'
  /** File size in bytes (folders: 0). */
  size: number
  /** Last modified ms epoch (folders: 0). */
  mtime: number
}

export interface VaultSearchHit {
  path: string
  lineNumber: number
  line: string
}

export class VaultFs {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly vaultRoot: string) {}

  get root(): string {
    return this.vaultRoot
  }

  private resolve(relative: string): string {
    return resolveVaultPath(this.vaultRoot, relative)
  }

  async exists(relative: string): Promise<boolean> {
    const abs = this.resolve(relative)
    try {
      await fs.access(abs)
      return true
    } catch {
      return false
    }
  }

  async read(relative: string): Promise<string> {
    const abs = assertWithinVault(this.vaultRoot, this.resolve(relative))
    return fs.readFile(abs, 'utf8')
  }

  async stat(relative: string): Promise<VaultFileEntry> {
    const abs = assertWithinVault(this.vaultRoot, this.resolve(relative))
    const st = await fs.stat(abs)
    return {
      path: normalizeVaultPath(relative),
      kind: st.isDirectory() ? 'folder' : 'file',
      size: st.size,
      mtime: st.mtimeMs,
    }
  }

  async write(relative: string, content: string): Promise<void> {
    const abs = this.resolve(relative)
    await this.ensureParentFolder(abs)
    await fs.writeFile(abs, content, 'utf8')
  }

  /** Serialized append (Claudian parity): concurrent appends never lose text. */
  async append(relative: string, content: string): Promise<void> {
    const abs = this.resolve(relative)
    await this.ensureParentFolder(abs)
    const task = this.writeQueue.then(async () => {
      if (await this.exists(relative)) {
        const existing = await this.read(relative)
        await fs.writeFile(abs, existing + content, 'utf8')
      } else {
        await fs.writeFile(abs, content, 'utf8')
      }
    }).catch(() => {
      // keep the queue from getting stuck; errors surface to the caller below
    })
    this.writeQueue = task
    await task
  }

  async delete(relative: string): Promise<void> {
    const abs = assertWithinVault(this.vaultRoot, this.resolve(relative))
    try {
      await fs.unlink(abs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Fails silently if non-empty or missing (Claudian parity). */
  async deleteFolder(relative: string): Promise<void> {
    const abs = this.resolve(relative)
    try {
      await fs.rmdir(abs)
    } catch {
      // Non-critical: directory may not be empty
    }
  }

  async move(source: string, target: string): Promise<void> {
    const srcAbs = assertWithinVault(this.vaultRoot, this.resolve(source))
    const dstAbs = this.resolve(target)
    await this.ensureParentFolder(path.dirname(dstAbs))
    await fs.rename(srcAbs, dstAbs)
  }

  async listFolder(folder: string): Promise<VaultFileEntry[]> {
    const normalized = folder === '' || folder === '.' ? '' : normalizeVaultFolder(folder)
    const abs = normalized === '' ? this.vaultRoot : this.resolve(normalized)
    let entries: string[]
    try {
      entries = await fs.readdir(abs)
    } catch {
      return []
    }
    const out: VaultFileEntry[] = []
    for (const name of entries) {
      if (name.startsWith('.')) continue // .obsidian/.claudian/.trash stay hidden from agents by default
      const childAbs = path.join(abs, name)
      const rel = normalized === '' ? name : normalized + '/' + name
      try {
        const st = await fs.stat(childAbs)
        out.push({
          path: rel,
          kind: st.isDirectory() ? 'folder' : 'file',
          size: st.isDirectory() ? 0 : st.size,
          mtime: st.mtimeMs,
        })
      } catch {
        // entry vanished mid-list
      }
    }
    out.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'folder' ? -1 : 1))
    return out
  }

  /** Recursive tree under a folder (bounded by maxEntries). */
  async listTree(folder: string, maxEntries = 2000, depth = 0): Promise<VaultFileEntry[]> {
    if (depth > 12) return []
    const entries = await this.listFolder(folder)
    const out: VaultFileEntry[] = []
    for (const entry of entries) {
      if (out.length >= maxEntries) break
      out.push(entry)
      if (entry.kind === 'folder') {
        const children = await this.listTree(entry.path, maxEntries - out.length, depth + 1)
        out.push(...children)
      }
    }
    return out
  }

  /** Case-insensitive grep over text files under a folder. */
  async search(folder: string, pattern: string, limit = 50): Promise<VaultSearchHit[]> {
    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
    const hits: VaultSearchHit[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.listFolder(dir)
      for (const entry of entries) {
        if (hits.length >= limit) return
        if (entry.kind === 'folder') {
          await walk(entry.path)
        } else if (/.(md|markdown|txt|canvas|json)$/i.test(entry.path)) {
          try {
            const content = await this.read(entry.path)
            const lines = content.split('\n')
            for (let i = 0; i < lines.length && hits.length < limit; i++) {
              if (re.test(lines[i])) {
                hits.push({ path: entry.path, lineNumber: i + 1, line: lines[i].slice(0, 500) })
              }
            }
          } catch {
            // unreadable/binary: skip
          }
        }
      }
    }
    await walk(folder === '' || folder === '.' ? '' : normalizeVaultFolder(folder))
    return hits
  }

  private async ensureParentFolder(absFile: string): Promise<void> {
    const parent = path.dirname(absFile)
    try {
      await fs.mkdir(parent, { recursive: true })
    } catch (error) {
      // mkdir({ recursive: true }) tolerates an existing folder; only
      // swallow the benign EEXIST case and surface anything else (a hidden
      // failure here previously made rename() fail with a misleading ENOENT).
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
    }
  }
}
