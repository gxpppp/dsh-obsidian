import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { BridgeError, ObsidianBridge, VaultFs } from '../lib/index.js'

const flag = process.argv.indexOf('--vault')
const vaultPath = flag >= 0 ? process.argv[flag + 1] : process.env.DSH_OBSIDIAN_VAULT
if (!vaultPath) {
  console.error('Usage: node --experimental-strip-types scripts/smoke-companion.mjs --vault <vault-path>')
  process.exit(2)
}

const vault = new VaultFs(vaultPath)
const bridge = new ObsidianBridge(() => ({ mode: 'companion', vaultPath }))
const id = Date.now().toString(36)
const folder = `DSH-Obsidian-Smoke-${id}`
const sourcePath = `${folder}/source.md`
const targetPath = `${folder}/target.md`
const attachmentPath = `${folder}/pixel.png`
const originalMarker = `DSH_REAL_SMOKE_${id}`
const updatedMarker = `${originalMarker}_UPDATED`
const results = {}

function record(name, value) {
  results[name] = value
  console.log(`[ok] ${name}`)
}

try {
  await vault.mkdir(folder)
  await vault.write(sourcePath, [
    '---',
    'tags: [dsh-smoke]',
    'phase: initial',
    '---',
    '# DSH companion smoke',
    originalMarker,
    '',
  ].join('\n'))
  await vault.write(targetPath, '# Smoke target\n')
  await vault.writeBinary(attachmentPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const status = await bridge.status()
  assert.equal(status.ok, true)
  assert.equal(status.channel, 'companion')
  assert.equal(status.pluginVersion, '0.3.1')
  assert.equal(status.vaultMatch, true)
  record('hello/status', { protocolVersion: status.protocolVersion, obsidianVersion: status.obsidianVersion })

  const commands = await bridge.listCommands()
  assert.ok(commands.length > 50)
  assert.ok(commands.some((command) => command.id === 'app:reload'))
  record('commands.list', { count: commands.length })

  await bridge.notice('DSH Obsidian 0.3.1 smoke test')
  record('notice', true)

  await bridge.openNote({ path: sourcePath, line: 6 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const state = await bridge.activeState(undefined, true)
  assert.equal(state?.path, sourcePath)
  assert.ok(state?.content?.includes(originalMarker))
  assert.ok(state?.revision)
  record('editor.open/state', { path: state.path, mode: state.mode })

  await assert.rejects(
    bridge.applyEdit({
      path: sourcePath,
      from: 0,
      to: 0,
      text: 'stale',
      revision: '0'.repeat(64),
      expectedText: '',
    }),
    (error) => error instanceof BridgeError && error.code === 'CONFLICT',
  )
  record('editor conflict guard', true)

  const markerOffset = state.content.indexOf(originalMarker)
  const edit = await bridge.applyEdit({
    path: sourcePath,
    from: markerOffset,
    to: markerOffset + originalMarker.length,
    text: updatedMarker,
    revision: state.revision,
    expectedText: originalMarker,
  })
  assert.match(edit.revision, /^[a-f0-9]{64}$/)
  const editedState = await bridge.activeState(undefined, true)
  assert.ok(editedState?.content?.includes(updatedMarker))
  record('editor.edit', { revision: edit.revision })

  await bridge.executeCommand('editor:save-file')
  record('commands.execute', { id: 'editor:save-file' })

  await new Promise((resolve) => setTimeout(resolve, 500))
  const metadata = await bridge.metadata(sourcePath)
  assert.equal(metadata.path, sourcePath)
  assert.ok(Array.isArray(metadata.headings))
  assert.ok(Array.isArray(metadata.tags))
  record('metadata.get', { tags: metadata.tags })

  const updatedMetadata = await bridge.updateFrontmatter({
    path: sourcePath,
    patch: { phase: 'online', smokeId: id },
    ifMatch: metadata.revision,
  })
  assert.equal(updatedMetadata.path, sourcePath)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const metadataAfterUpdate = await bridge.metadata(sourcePath)
  assert.equal(metadataAfterUpdate.frontmatter.phase, 'online')
  assert.equal(metadataAfterUpdate.frontmatter.smokeId, id)
  record('frontmatter.update', metadataAfterUpdate.frontmatter)

  const search = await bridge.searchIndexed({
    query: updatedMarker,
    tags: ['dsh-smoke'],
    properties: { phase: 'online' },
    limit: 10,
  })
  assert.ok(search.results.some((result) => result.path === sourcePath))
  record('search filters', { hits: search.results.length })

  const resolved = await bridge.resolveLink({ link: basename(targetPath, '.md'), sourcePath })
  assert.equal(resolved.path, targetPath)
  record('links.resolve', resolved)

  const sourceBeforeLink = await bridge.metadata(sourcePath)
  const inserted = await bridge.insertLink({
    path: sourcePath,
    target: targetPath,
    display: 'smoke target',
    ifMatch: sourceBeforeLink.revision,
  })
  assert.ok(inserted.link.includes('smoke target'))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const links = await bridge.links(sourcePath)
  assert.ok(links.outgoing.some((link) => link.target === targetPath))
  record('links.insert/list', { link: inserted.link, outgoing: links.outgoing.length })

  const attachment = await bridge.addAttachment({ path: attachmentPath, sourcePath })
  assert.equal(attachment.path, attachmentPath)
  assert.equal(attachment.mediaType, 'image/png')
  assert.ok(attachment.link)
  record('attachments.add', attachment)

  console.log(JSON.stringify({ ok: true, results }, null, 2))
} finally {
  try {
    if (await vault.exists('欢迎.md')) await bridge.openNote({ path: '欢迎.md' })
  } catch {
    // The smoke folder is still removed even when no fallback note exists.
  }
  await new Promise((resolve) => setTimeout(resolve, 200))
  await vault.delete(folder, { permanent: true }).catch(() => undefined)
}
