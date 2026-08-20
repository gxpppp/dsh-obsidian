import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BridgeError, ObsidianBridge } from '../src/bridge/bridge.ts'
import {
  BRIDGE_PROTOCOL_VERSION,
  canonicalVaultIdentity,
  companionEndpoint,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope,
} from '../src/bridge/protocol.ts'

interface MockHandle {
  server: Server
  endpoint: string
  requests: BridgeRequestEnvelope[]
  vaultPath: string
}

let root = ''
let mock: MockHandle

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'dsh-obsidian-bridge-test-'))
  mock = await startMock(root)
})

after(async () => {
  await new Promise<void>((resolve) => mock.server.close(() => resolve()))
  rmSync(root, { recursive: true, force: true })
})

async function startMock(vaultPath: string): Promise<MockHandle> {
  const requests: BridgeRequestEnvelope[] = []
  const endpoint = companionEndpoint(undefined, `test-${randomUUID()}`)
  const server = createServer((socket) => handleSocket(socket, requests, vaultPath))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  return { server, endpoint, requests, vaultPath }
}

function handleSocket(socket: Socket, requests: BridgeRequestEnvelope[], vaultPath: string): void {
  let input = ''
  socket.on('data', (chunk) => {
    input += chunk.toString('utf8')
    const newline = input.indexOf('\n')
    if (newline < 0) return
    const request = JSON.parse(input.slice(0, newline)) as BridgeRequestEnvelope
    requests.push(request)
    if (request.method === 'hang') return
    if (request.token !== 'test-token') {
      respond(socket, request.requestId, false, undefined, { code: 'UNAUTHORIZED', message: 'bad token' })
      return
    }
    if (request.method === 'hello') {
      respond(socket, request.requestId, true, {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        pluginVersion: '0.3.1',
        obsidianVersion: '1.13.1',
        vault: canonicalVaultIdentity(vaultPath),
        capabilities: ['editor.state', 'editor.edit'],
      })
      return
    }
    if (request.method === 'editor.state') {
      respond(socket, request.requestId, true, {
        channel: 'companion', path: 'notes/active.md', mode: 'source',
        content: 'hello world', revision: 'a'.repeat(64),
        selection: { from: 6, to: 11, text: 'world' }, cursor: null,
        openTabs: ['notes/active.md'],
      })
      return
    }
    if (request.method === 'editor.edit') {
      respond(socket, request.requestId, true, { revision: 'b'.repeat(64) })
      return
    }
    respond(socket, request.requestId, false, undefined, { code: 'UNSUPPORTED', message: 'unsupported method' })
  })
}

function respond(socket: Socket, requestId: string, ok: boolean, data?: unknown, error?: { code: string; message: string }): void {
  const response: BridgeResponseEnvelope = ok
    ? { protocolVersion: BRIDGE_PROTOCOL_VERSION, requestId, ok: true, data }
    : { protocolVersion: BRIDGE_PROTOCOL_VERSION, requestId, ok: false, error: error! }
  socket.end(`${JSON.stringify(response)}\n`)
}

function bridgeFor(options: { token?: string; vaultPath?: string; timeoutMs?: number } = {}): ObsidianBridge {
  return new ObsidianBridge(() => ({
    mode: 'companion',
    vaultPath: options.vaultPath ?? root,
    companionEndpoint: mock.endpoint,
    companionToken: options.token ?? 'test-token',
    timeoutMs: options.timeoutMs,
  }))
}

describe('ObsidianBridge IPC v1', () => {
  it('performs hello and reads active state with selection', async () => {
    const state = await bridgeFor().activeState()
    assert.equal(state?.channel, 'companion')
    assert.equal(state?.path, 'notes/active.md')
    assert.equal(state?.revision, 'a'.repeat(64))
    assert.deepEqual(state?.selection, { from: 6, to: 11, text: 'world' })
  })

  it('sends revision and expected text for conflict-safe edits', async () => {
    const result = await bridgeFor().applyEdit({
      path: 'notes/active.md', from: 6, to: 11, text: 'vault',
      revision: 'a'.repeat(64), expectedText: 'world',
    })
    assert.equal(result.revision, 'b'.repeat(64))
    const edit = mock.requests.findLast((request) => request.method === 'editor.edit')
    assert.deepEqual(edit?.params, {
      path: 'notes/active.md', from: 6, to: 11, text: 'vault',
      revision: 'a'.repeat(64), expectedText: 'world',
    })
  })

  it('rejects a wrong token with a structured error', async () => {
    await assert.rejects(bridgeFor({ token: 'wrong-token' }).activeState(), (error: unknown) => {
      assert.ok(error instanceof BridgeError)
      assert.equal(error.code, 'UNAUTHORIZED')
      return true
    })
  })

  it('fails closed when the companion serves another vault', async () => {
    const other = mkdtempSync(join(tmpdir(), 'dsh-obsidian-other-'))
    try {
      await assert.rejects(bridgeFor({ vaultPath: other }).activeState(), (error: unknown) => {
        assert.ok(error instanceof BridgeError)
        assert.equal(error.code, 'VAULT_MISMATCH')
        return true
      })
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('honors timeout and abort signals', async () => {
    const bridge = bridgeFor({ timeoutMs: 25 })
    await assert.rejects(
      (bridge as unknown as { requestRaw<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> }).requestRaw('hang', {}),
      (error: unknown) => error instanceof BridgeError && error.code === 'TIMEOUT',
    )
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(bridge.activeState(controller.signal), (error: unknown) => error instanceof BridgeError && error.code === 'ABORTED')
  })

  it('rejects requests larger than the protocol limit before connecting', async () => {
    const bridge = bridgeFor() as unknown as { requestRaw<T>(method: string, params: unknown): Promise<T> }
    await assert.rejects(
      bridge.requestRaw('oversized.test', { payload: 'x'.repeat(1024 * 1024) }),
      (error: unknown) => error instanceof BridgeError && error.code === 'TOO_LARGE',
    )
  })
})
