import { basename, extname, posix } from 'node:path'
import { AttachmentId, type ImageAttachmentRef, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { normalizeVaultPath } from '../vault/vaultPaths.ts'
import { requireFs, type ToolHost } from './context.ts'
import { canUseOfflineFallback, openObjectOutput, safeModelText } from './helpers.ts'

const IMAGE_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function registerAttachmentTools(host: ToolHost): ToolDefinition[] {
  const add = defineTool({
    name: 'obsidian_attachment_add',
    description: 'Add an attachment from a DSH durable image reference or copy an existing vault attachment. Absolute host paths and URLs are rejected.',
    parameters: {
      source_path: { type: 'string' },
      target_name: { type: 'string' },
      source_note: { type: 'string' },
      attachment_id: { type: 'string' },
      media_type: { type: 'string', enum: IMAGE_TYPES },
      bytes: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      display_name: { type: 'string' },
    },
    output: openObjectOutput((value) => ['Added attachment ', safeModelText(value.path), ' (', String(value.bytes), ' bytes)'].join('')),
    execute: async (args, exec) => {
      let data: Uint8Array
      let mediaType = args.media_type as ImageMediaType | undefined
      let name = args.target_name ?? args.display_name
      if (args.source_path) {
        const source = await requireFs(host).readBinary(normalizeVaultPath(args.source_path), exec.signal)
        data = source.data
        name ??= basename(args.source_path)
        mediaType ??= mimeForName(name) as ImageMediaType | undefined
      } else {
        if (!args.attachment_id || !args.media_type || args.bytes === undefined || args.width === undefined || args.height === undefined) {
          throw new Error('Provide source_path or a complete DSH image attachment reference')
        }
        const store = host.attachments?.()
        if (store === undefined) throw new Error('The DSH attachment service is unavailable')
        const reference: ImageAttachmentRef = {
          attachmentId: AttachmentId(args.attachment_id), mediaType: args.media_type,
          bytes: args.bytes, width: args.width, height: args.height, name: args.display_name,
        }
        const stored = await store.readImage(reference, exec.signal)
        data = stored.data
        name ??= stored.ref.name ?? [stored.ref.attachmentId, '.', extensionForMedia(stored.ref.mediaType)].join('')
      }
      name = safeFilename(name ?? 'attachment.bin')
      if (data.byteLength > host.config().maxAttachmentBytes) throw new Error('Attachment exceeds maxAttachmentBytes')
      const target = await availablePath(host, name, exec.signal)
      const file = await requireFs(host).writeBinary(target, data, { signal: exec.signal })
      if (host.config().mode !== 'fs') {
        try {
          const result = await host.bridge().addAttachment({
            path: file.path,
            sourcePath: args.source_note ? normalizeVaultPath(args.source_note) : undefined,
          }, exec.signal)
          return { path: result.path, bytes: result.bytes, mediaType: result.mediaType ?? mediaType ?? '', link: result.link, revision: file.revision }
        } catch (error) {
          if (!canUseOfflineFallback(host, error)) {
            await requireFs(host).delete(file.path, { permanent: true, ifMatch: file.revision, signal: exec.signal }).catch(() => undefined)
            throw error
          }
        }
      }
      return { path: file.path, bytes: file.size, mediaType: mediaType ?? '', link: ['![[', file.path, ']]'].join(''), revision: file.revision }
    },
  })

  const read = defineTool({
    name: 'obsidian_attachment_read',
    description: 'Read attachment metadata. Optionally publish a supported image to the DSH attachment store as a durable reference; raw bytes are not returned to the model.',
    parameters: { path: { type: 'string', required: true }, publish_image: { type: 'boolean' } },
    output: openObjectOutput((value) => [safeModelText(value.path), ': ', String(value.bytes), ' bytes', value.attachment ? '; DSH reference created' : ''].join('')),
    execute: async (args, exec) => {
      const file = await requireFs(host).readBinary(normalizeVaultPath(args.path), exec.signal)
      const mediaType = mimeForName(file.path)
      let attachment: JsonValue = null
      if (args.publish_image) {
        if (!mediaType || !IMAGE_TYPES.includes(mediaType as ImageMediaType)) throw new Error('Only PNG, JPEG, WebP, and GIF can be published to the DSH image store')
        const store = host.attachments?.()
        if (store === undefined) throw new Error('The DSH attachment service is unavailable')
        attachment = await store.saveImage({ data: file.data, mediaType: mediaType as ImageMediaType, name: basename(file.path) }) as unknown as JsonValue
      }
      return { path: file.path, bytes: file.size, mediaType: mediaType ?? '', revision: file.revision, attachment }
    },
    isConcurrencySafe: () => true,
  })

  return [add, read]
}

async function availablePath(host: ToolHost, name: string, signal: AbortSignal): Promise<string> {
  const folder = normalizeVaultPath(host.config().attachmentFolder)
  const parsed = posix.parse(name)
  for (let index = 0; index < 1000; index++) {
    const filename = index === 0 ? name : [parsed.name, '-', String(index), parsed.ext].join('')
    const candidate = posix.join(folder, filename)
    if (!(await requireFs(host).exists(candidate, signal))) return candidate
  }
  throw new Error('Unable to allocate a unique attachment filename')
}
function safeFilename(value: string): string {
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.startsWith('.') || /[\u0000-\u001f:]/.test(value)) throw new Error('Attachment name must be a plain filename')
  return value
}
function mimeForName(value: string): string | undefined {
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' }
  return types[extname(value).toLowerCase()]
}
function extensionForMedia(value: ImageMediaType): string { return value === 'image/jpeg' ? 'jpg' : value.slice('image/'.length) }
