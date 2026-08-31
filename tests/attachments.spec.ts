import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { AttachmentId, type AttachmentStore, type ImageAttachmentRef, type StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { DEFAULT_CONFIG, type Config } from '../src/settings/schema.ts'
import { registerAttachmentTools } from '../src/tools/attachmentTools.ts'
import type { ToolHost } from '../src/tools/context.ts'
import { VaultFs } from '../src/vault/vaultFs.ts'

const IMAGE_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('attachment-test'),
  mediaType: 'image/png',
  bytes: IMAGE_BYTES.byteLength,
  width: 1,
  height: 1,
  name: 'stored.png',
}

let root = ''
let vault: VaultFs

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-obsidian-attachments-'))
  vault = new VaultFs(root, { maxBinaryBytes: 1024 })
})

after(() => rmSync(root, { recursive: true, force: true }))

function execution(signal = new AbortController().signal): ToolRunContext {
  const callId = ToolCallId('attachment-test-call')
  return {
    callId,
    rootCallId: callId,
    name: 'attachment-test',
    arguments: {},
    signal,
    token: Symbol('attachment-test-token'),
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as unknown as ToolRunContext
}

function host(store: Pick<AttachmentStore, 'readImage' | 'saveImage'>, config: Config = DEFAULT_CONFIG): ToolHost {
  return {
    fs: () => vault,
    bridge: () => { throw new Error('bridge should not be used in fs mode') },
    config: () => ({ ...config, vaultPath: root, mode: 'fs', attachmentFolder: 'Attachments' }),
    attachments: () => store as AttachmentStore,
  }
}

function tool(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((candidate) => candidate.name === name)
  assert.ok(found, `missing tool ${name}`)
  return found
}

describe('DSH alpha.2 attachment contracts', () => {
  it('imports a durable image through readImage and forwards cancellation', async () => {
    let observedSignal: AbortSignal | undefined
    const store = {
      readImage: async (ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> => {
        assert.deepEqual(ref, IMAGE_REF)
        observedSignal = signal
        return { ref: IMAGE_REF, data: IMAGE_BYTES }
      },
      saveImage: async () => IMAGE_REF,
    }
    const controller = new AbortController()
    const add = tool(registerAttachmentTools(host(store)), 'obsidian_attachment_add')
    const result = await add.execute({
      attachment_id: IMAGE_REF.attachmentId,
      media_type: IMAGE_REF.mediaType,
      bytes: IMAGE_REF.bytes,
      width: IMAGE_REF.width,
      height: IMAGE_REF.height,
      display_name: IMAGE_REF.name,
    }, execution(controller.signal)) as Record<string, unknown>

    assert.equal(observedSignal, controller.signal)
    assert.equal(result.path, 'Attachments/stored.png')
    assert.equal(result.bytes, IMAGE_BYTES.byteLength)
    assert.equal('data' in result, false)
    assert.deepEqual(Array.from((await vault.readBinary('Attachments/stored.png')).data), Array.from(IMAGE_BYTES))
  })

  it('publishes a vault image through saveImage without returning bytes', async () => {
    await vault.writeBinary('source.png', IMAGE_BYTES)
    let saved: { data: Uint8Array; mediaType: string; name?: string } | undefined
    const store = {
      readImage: async (): Promise<StoredImageAttachment> => ({ ref: IMAGE_REF, data: IMAGE_BYTES }),
      saveImage: async (input: { data: Uint8Array; mediaType: string; name?: string }) => {
        saved = input
        return IMAGE_REF
      },
    }
    const read = tool(registerAttachmentTools(host(store)), 'obsidian_attachment_read')
    const result = await read.execute({ path: 'source.png', publish_image: true }, execution()) as Record<string, unknown>

    assert.equal(saved?.mediaType, 'image/png')
    assert.equal(saved?.name, 'source.png')
    assert.deepEqual(Array.from(saved?.data ?? []), Array.from(IMAGE_BYTES))
    assert.deepEqual(result.attachment, IMAGE_REF)
    assert.equal('data' in result, false)
  })

  it('rejects oversized durable images before writing to the vault', async () => {
    const oversized = new Uint8Array(2048)
    const ref = { ...IMAGE_REF, bytes: oversized.byteLength, name: 'oversized.png' }
    const store = {
      readImage: async (): Promise<StoredImageAttachment> => ({ ref, data: oversized }),
      saveImage: async () => ref,
    }
    const add = tool(registerAttachmentTools(host(store, { ...DEFAULT_CONFIG, maxAttachmentBytes: 1024 })), 'obsidian_attachment_add')

    await assert.rejects(add.execute({
      attachment_id: ref.attachmentId,
      media_type: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      display_name: ref.name,
    }, execution()), /exceeds maxAttachmentBytes/)
    assert.equal(await vault.exists('Attachments/oversized.png'), false)
  })

  it('does not call saveImage after an aborted vault read', async () => {
    await vault.writeBinary('aborted.png', IMAGE_BYTES)
    let saveCalls = 0
    const store = {
      readImage: async (): Promise<StoredImageAttachment> => ({ ref: IMAGE_REF, data: IMAGE_BYTES }),
      saveImage: async () => { saveCalls += 1; return IMAGE_REF },
    }
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const read = tool(registerAttachmentTools(host(store)), 'obsidian_attachment_read')

    await assert.rejects(read.execute({ path: 'aborted.png', publish_image: true }, execution(controller.signal)), /cancelled/)
    assert.equal(saveCalls, 0)
  })
})
