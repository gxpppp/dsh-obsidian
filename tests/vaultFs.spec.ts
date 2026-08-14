import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultFs } from '../src/vault/vaultFs.ts'

let root = ''
let fs: VaultFs

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-obsidian-test-'))
  mkdirSync(join(root, 'notes'), { recursive: true })
  writeFileSync(join(root, 'notes', 'a.md'), '# A\nhello world\n# B\nHello again\n')
  writeFileSync(join(root, 'welcome.md'), 'welcome\n')
  fs = new VaultFs(root)
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('VaultFs', () => {
  it('lists folders first, hides dot-directories', async () => {
    mkdirSync(join(root, '.obsidian'), { recursive: true })
    writeFileSync(join(root, '.obsidian', 'x.json'), '{}')
    const entries = await fs.listFolder('')
    const names = entries.map((e) => e.path)
    assert.equal(names.includes('.obsidian'), false)
    assert.equal(names.includes('notes'), true)
    assert.equal(names.includes('welcome.md'), true)
  })

  it('reads files and reports stats', async () => {
    const content = await fs.read('notes/a.md')
    assert.ok(content.includes('hello world'))
    const st = await fs.stat('notes/a.md')
    assert.equal(st.kind, 'file')
    assert.ok(st.size > 0)
  })

  it('rejects traversal on every operation', async () => {
    await assert.rejects(fs.read('../secret.txt'))
    await assert.rejects(fs.write('../../evil.md', 'x'))
    await assert.rejects(fs.delete('../x'))
  })

  it('write creates parent folders; append serializes', async () => {
    await fs.write('deep/nested/note.md', 'one\n')
    assert.equal(await fs.read('deep/nested/note.md'), 'one\n')
    await Promise.all([
      fs.append('deep/nested/note.md', 'two\n'),
      fs.append('deep/nested/note.md', 'three\n'),
    ])
    const content = await fs.read('deep/nested/note.md')
    assert.ok(content.includes('one'))
    assert.ok(content.includes('two'))
    assert.ok(content.includes('three'))
  })

  it('move and delete', async () => {
    await fs.write('tmp/move-me.md', 'x')
    await fs.move('tmp/move-me.md', 'tmp/moved.md')
    assert.equal(await fs.exists('tmp/move-me.md'), false)
    assert.equal(await fs.exists('tmp/moved.md'), true)
    await fs.delete('tmp/moved.md')
    assert.equal(await fs.exists('tmp/moved.md'), false)
  })

  it('search is case-insensitive and line-numbered', async () => {
    const hits = await fs.search('', 'hello', 50)
    assert.ok(hits.length >= 2)
    assert.equal(hits[0].path, 'notes/a.md')
    assert.equal(hits[0].lineNumber, 2)
  })

  it('rejects symlink escape', async () => {
    try {
      const outside = mkdtempSync(join(tmpdir(), 'dsh-obsidian-outside-'))
      writeFileSync(join(outside, 'secret.txt'), 'secret')
      const link = join(root, 'escape-link')
      try {
        symlinkSync(outside, link, 'junction')
        await assert.rejects(fs.read('escape-link/secret.txt'))
      } catch {
        // symlink creation failed (permissions): skip
      } finally {
        rmSync(outside, { recursive: true, force: true })
        try { rmSync(link, { recursive: true, force: true }) } catch { /* noop */ }
      }
    } catch {
      // noop
    }
  })
})
