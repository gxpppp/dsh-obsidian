import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve as pathResolve } from 'node:path'
import { VaultPathError, normalizeVaultPath, resolveVaultPath, pathEquals } from '../src/vault/vaultPaths.ts'

describe('normalizeVaultPath', () => {
  it('accepts clean vault-relative paths', () => {
    assert.equal(normalizeVaultPath('notes/foo.md'), 'notes/foo.md')
    assert.equal(normalizeVaultPath('foo.md'), 'foo.md')
    assert.equal(normalizeVaultPath('a/b/c/考研/note.md'), 'a/b/c/考研/note.md')
  })

  it('rejects traversal, absolute, drive, and backslash paths', () => {
    assert.throws(() => normalizeVaultPath('../x'), VaultPathError)
    assert.throws(() => normalizeVaultPath('a/../../x'), VaultPathError)
    assert.throws(() => normalizeVaultPath('/abs/x'), VaultPathError)
    assert.throws(() => normalizeVaultPath('C:/x'), VaultPathError)
    assert.throws(() => normalizeVaultPath('a\\b'), VaultPathError)
    assert.throws(() => normalizeVaultPath('a//b'), VaultPathError)
    assert.throws(() => normalizeVaultPath(''), VaultPathError)
    assert.throws(() => normalizeVaultPath('.'), VaultPathError)
    assert.throws(() => normalizeVaultPath('a/./b'), VaultPathError)
  })
})

describe('resolveVaultPath', () => {
  it('resolves inside the vault root only', () => {
    const root = 'E:/vault'
    const resolved = resolveVaultPath(root, 'notes/foo.md')
    assert.equal(pathEquals(resolved, pathResolve('E:/vault/notes/foo.md')), true)
  })

  it('rejects escapes', () => {
    assert.throws(() => resolveVaultPath('E:/vault', '../x'), VaultPathError)
  })
})
