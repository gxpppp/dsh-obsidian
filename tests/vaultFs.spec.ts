import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
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

  it('moves and trashes files and folders', async () => {
    await fs.write('tmp/move-me.md', 'x')
    await fs.move('tmp/move-me.md', 'tmp/moved.md')
    assert.equal(await fs.exists('tmp/move-me.md'), false)
    assert.equal(await fs.exists('tmp/moved.md'), true)
    await fs.delete('tmp/moved.md')
    assert.equal(await fs.exists('tmp/moved.md'), false)

    await fs.write('folder-source/nested/note.md', 'folder')
    await fs.move('folder-source', 'folder-target')
    assert.equal(await fs.exists('folder-source/nested/note.md'), false)
    assert.equal(await fs.read('folder-target/nested/note.md'), 'folder')
    await fs.delete('folder-target')
    assert.equal(await fs.exists('folder-target/nested/note.md'), false)
  })

  it('search is case-insensitive and line-numbered', async () => {
    const hits = await fs.search('', 'hello', 50)
    assert.ok(hits.length >= 2)
    assert.equal(hits[0].path, 'notes/a.md')
    assert.equal(hits[0].lineNumber, 2)
  })

  it('rejects symlink escape for reads and write targets', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'dsh-obsidian-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    const link = join(root, 'escape-link')
    let linked = false
    try {
      try {
        symlinkSync(outside, link, 'junction')
        linked = true
      } catch {
        return
      }
      await assert.rejects(fs.read('escape-link/secret.txt'))
      await assert.rejects(fs.write('escape-link/created.md', 'escape'))
      await assert.rejects(fs.copy('welcome.md', 'escape-link/copied.md'))
      await assert.rejects(fs.move('welcome.md', 'escape-link/moved.md'))
      assert.equal(existsSync(join(outside, 'created.md')), false)
      assert.equal(existsSync(join(outside, 'copied.md')), false)
      assert.equal(existsSync(join(outside, 'moved.md')), false)
    } finally {
      if (linked) try { rmSync(link, { recursive: true, force: true }) } catch { /* noop */ }
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects protected dot paths even when named directly', async () => {
    await assert.rejects(fs.read('.obsidian/x.json'))
    await assert.rejects(fs.write('.trash/escape.md', 'x'))
    await assert.rejects(fs.mkdir('.git/objects'))
  })

  it('returns revisions, rejects stale updates, and protects copy targets', async () => {
    const first = await fs.write('revision.md', 'first')
    const second = await fs.write('revision.md', 'second', { ifMatch: first.revision })
    assert.notEqual(first.revision, second.revision)
    await assert.rejects(fs.write('revision.md', 'stale', { ifMatch: first.revision }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'CONFLICT')
      return true
    })
    assert.equal(await fs.read('revision.md'), 'second')

    await fs.write('copy-source.md', 'source')
    const target = await fs.write('copy-target.md', 'target')
    await assert.rejects(fs.copy('copy-source.md', 'copy-target.md'), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ALREADY_EXISTS')
      return true
    })
    await fs.copy('copy-source.md', 'copy-target.md', { ifMatch: target.revision })
    assert.equal(await fs.read('copy-target.md'), 'source')
  })

  it('supports binary round trips and size limits', async () => {
    const small = new Uint8Array([0, 1, 2, 255])
    const written = await fs.writeBinary('assets/image.bin', small)
    const read = await fs.readBinary('assets/image.bin')
    assert.equal(read.revision, written.revision)
    assert.deepEqual([...read.data], [...small])
    const limited = new VaultFs(root, { maxBinaryBytes: 3 })
    await assert.rejects(limited.writeBinary('assets/too-large.bin', small), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'TOO_LARGE')
      return true
    })
  })

  it('honors cancellation before filesystem work starts', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await assert.rejects(fs.write('cancelled.md', 'x', { signal: controller.signal }), /cancelled/)
    assert.equal(await fs.exists('cancelled.md'), false)
  })
})
