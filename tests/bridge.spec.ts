import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ObsidianBridge, BridgeError } from '../src/bridge/bridge.ts'

interface MockHandle {
  server: Server
  port: number
  requests: Array<{ path: string; body?: unknown }>
}

async function startMock(): Promise<MockHandle> {
  const requests: Array<{ path: string; body?: unknown }> = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body: body ? JSON.parse(body) : undefined })
      const auth = req.headers.authorization
      if (auth !== 'Bearer test-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, detail: 'mock' }))
        return
      }
      if (req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          path: 'notes/active.md',
          mode: 'source',
          content: 'hello world',
          selection: { from: 6, to: 11, text: 'world' },
          cursor: null,
          openTabs: ['notes/active.md'],
        }))
        return
      }
      if (req.url === '/api/edit') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return { server, port, requests }
}

let mock: MockHandle | undefined

after(() => {
  mock?.server.close()
})

function bridgeFor(port: number, token: string): ObsidianBridge {
  return new ObsidianBridge(() => ({
    mode: 'companion',
    restUrl: 'http://127.0.0.1:27123',
    companionPort: port,
    companionToken: token,
  }))
}

describe('ObsidianBridge (companion channel)', () => {
  it('reads active state with selection', async () => {
    mock = await startMock()
    const state = await bridgeFor(mock.port, 'test-token').activeState()
    assert.notEqual(state, null)
    assert.equal(state?.channel, 'companion')
    assert.equal(state?.path, 'notes/active.md')
    assert.deepEqual(state?.selection, { from: 6, to: 11, text: 'world' })
  })

  it('applies an edit through /api/edit', async () => {
    await bridgeFor(mock!.port, 'test-token').applyEdit({ path: 'notes/active.md', from: 6, to: 11, text: 'vault' })
    const editCall = mock!.requests.find((r) => r.path === '/api/edit')
    assert.deepEqual(editCall?.body, { path: 'notes/active.md', from: 6, to: 11, text: 'vault' })
  })

  it('rejects a wrong token', async () => {
    await assert.rejects(bridgeFor(mock!.port, 'wrong-token').activeState(), BridgeError)
  })

  it('reports unreachable channels in health', async () => {
    const bridge = new ObsidianBridge(() => ({
      mode: 'companion',
      restUrl: 'http://127.0.0.1:1',
      companionPort: 1,
      companionToken: 'x',
    }))
    const health = await bridge.health()
    assert.equal(health.ok, false)
    assert.equal(health.channel, 'none')
  })
})
