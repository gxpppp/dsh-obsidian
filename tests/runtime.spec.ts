import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG, type Config } from '../src/settings/schema.ts'

interface SettingsHooks {
  setSource: (source: () => Config) => void
  onChange: () => void
  validate: (config: Config) => void
}

interface FakeHarness {
  ctx: Context
  handlers: Map<string, (payload: unknown) => void>
  settings: SettingsHooks | undefined
}

let root = ''

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-obsidian-runtime-'))
})

after(() => rmSync(root, { recursive: true, force: true }))

function fakeContext(): FakeHarness {
  const harness: FakeHarness = {
    ctx: undefined as unknown as Context,
    handlers: new Map(),
    settings: undefined,
  }
  harness.ctx = {
    inject: (names: readonly string[], callback: (injected: unknown) => void) => {
      if (names.includes('settings')) {
        callback({
          settings: {
            installSection: (...args: unknown[]) => {
              harness.settings = args[4] as SettingsHooks
            },
          },
        })
      }
    },
    on: (event: string, listener: (payload: unknown) => void) => {
      harness.handlers.set(event, listener)
      return () => { if (harness.handlers.get(event) === listener) harness.handlers.delete(event) }
    },
    get: () => undefined,
    logger: () => ({ info: () => {}, warn: () => {} }),
    effect: () => () => undefined,
  } as unknown as Context
  return harness
}

function fakeAgent(): { agent: Agent; registered: ToolDefinition[] } {
  const registered: ToolDefinition[] = []
  const agent = {
    id: 'runtime-test-agent',
    ctx: {
      tools: {
        register: (tool: ToolDefinition) => {
          registered.push(tool)
          return () => {
            const index = registered.indexOf(tool)
            if (index >= 0) registered.splice(index, 1)
          }
        },
      },
      systemPrompt: { section: () => () => {} },
      on: () => () => {},
    },
  } as unknown as Agent
  return { agent, registered }
}

function execution(): ToolRunContext {
  const callId = ToolCallId('runtime-test-call')
  return {
    callId,
    rootCallId: callId,
    name: 'runtime-test',
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol('runtime-test-token'),
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as unknown as ToolRunContext
}

function activate(harness: FakeHarness): ToolDefinition[] {
  const { agent, registered } = fakeAgent()
  const listener = harness.handlers.get('agent/inbox/inserted')
  assert.ok(listener, 'activation listener is registered')
  listener({ agent, message: { content: 'obsidian' } })
  assert.equal(registered.length, 25)
  return registered
}

function tool(registered: ToolDefinition[], name: string): ToolDefinition {
  const found = registered.find((candidate) => candidate.name === name)
  assert.ok(found, `missing tool ${name}`)
  return found
}

describe('runtime settings integration', () => {
  it('enforces the initial Vault limits through activated tools without a settings provider', async () => {
    const harness = fakeContext()
    apply(harness.ctx, { ...DEFAULT_CONFIG, vaultPath: root, maxTextBytes: 1024 })
    const write = tool(activate(harness), 'obsidian_write')

    await assert.rejects(
      write.execute({ path: 'big.md', content: 'x'.repeat(3000) }, execution()),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TOO_LARGE')
        return true
      },
    )
    assert.equal(existsSync(join(root, 'big.md')), false)
  })

  it('recreates the Vault with new limits and protected paths after live settings changes', async () => {
    const harness = fakeContext()
    const initial: Config = { ...DEFAULT_CONFIG, vaultPath: root, maxTextBytes: 1024 }
    apply(harness.ctx, initial)
    assert.ok(harness.settings, 'settings hooks are captured')

    const live: Config = {
      ...initial,
      maxTextBytes: 65536,
      protectedPaths: [...DEFAULT_CONFIG.protectedPaths, '.blocked'],
    }
    harness.settings.setSource(() => live)
    harness.settings.onChange()
    const write = tool(activate(harness), 'obsidian_write')

    const result = await write.execute({ path: 'big.md', content: 'x'.repeat(3000) }, execution()) as Record<string, unknown>
    assert.equal(result.path, 'big.md')
    assert.ok(existsSync(join(root, 'big.md')))

    await assert.rejects(
      write.execute({ path: '.blocked/hidden.md', content: 'y' }, execution()),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'PROTECTED_PATH')
        return true
      },
    )
    assert.equal(existsSync(join(root, '.blocked')), false)
  })
})
