/**
 * dsh-obsidian host half (port of Claudian's Obsidian interaction surface to
 * the DSH host process). On-demand by design:
 * - the ONLY always-on presence is the one-line `obsidian` skill catalog entry
 *   (full guidance loads on demand via the skill tool);
 * - the 14 obsidian_* tools and the guidance section are injected into ONE
 *   agent's scope only when a user message matches the trigger vocabulary —
 *   every other session stays free of them, like an unconnected MCP server;
 * - a /obsidian RPC channel serves the browser half (settings card/panel).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Config, DEFAULT_CONFIG, OBSIDIAN_SETTINGS_NAMESPACE, type Config as PluginConfig } from './settings/schema.ts'
import { VaultFs } from './vault/vaultFs.ts'
import { detectVaultPath, detectVaults } from './vault/detect.ts'
import { ObsidianBridge } from './bridge/bridge.ts'
import { watchActivation, fileActivationLog } from './activation.ts'
import { registerObsidianSkill } from './skill.ts'
import { join } from 'node:path'
import type { ToolHost } from './tools/context.ts'

export const inject = ['systemPrompt', 'tools', 'connection']

/** The live authoritative config: settings section once served, entry otherwise. */
let current: () => PluginConfig = () => DEFAULT_CONFIG
/** Active disposers from the last sync (tools/prompt/rpc). */
let activeDispose: (() => void) | undefined

function makeHost(): ToolHost {
  return {
    fs: () => {
      const path = current().vaultPath
      return path ? new VaultFs(path) : null
    },
    bridge: () => new ObsidianBridge(() => ({
      mode: current().mode ?? 'auto',
      restUrl: current().restUrl ?? 'http://127.0.0.1:27123',
      restToken: current().restToken,
      companionPort: current().companionPort ?? 34567,
      companionToken: current().companionToken,
    })),
    config: () => current(),
  }
}

function rpcOk<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function rpcErr(error: unknown): RpcResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function sync(ctx: Context): void {
  if (activeDispose !== undefined) {
    activeDispose()
    activeDispose = undefined
  }
  const config = current()
  if (config.enabled === false) return

  const host = makeHost()
  const disposers: Array<() => void> = []

  // On-demand skill facade: one catalog line (name + description + whenToUse),
  // full guidance body loaded only when invoked. This is the only always-on
  // presence when `announceToAgent` is enabled.
  if (config.announceToAgent !== false) {
    const disposeSkill = registerObsidianSkill(ctx)
    if (disposeSkill !== undefined) disposers.push(disposeSkill)
  }

  // On-demand activation: two listener channels (agent inbox + session event
  // log) feed one idempotent per-agent injection. On a trigger hit, the 14
  // tools + guidance section are registered into THAT agent's scope; other
  // agents never see them (unconnected-MCP semantics). Everything unwinds
  // with the agent and with this sync's disposer.
  if (config.autoActivate !== false) {
    const keywords = config.triggerKeywords?.length ? config.triggerKeywords : DEFAULT_CONFIG.triggerKeywords
    const projectRoot = import.meta.dirname !== undefined ? join(import.meta.dirname, '..') : process.cwd()
    disposers.push(watchActivation(ctx, keywords, makeHost, fileActivationLog(projectRoot)))
  }

  // /obsidian RPC channel for the browser half.
  const bridge = host.bridge()
  disposers.push(ctx.connection.rpc.handle('/obsidian', async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'config': {
          const cfg = current()
          return rpcOk({
            vaultPath: cfg.vaultPath,
            mode: cfg.mode,
            restUrl: cfg.restUrl,
            companionPort: cfg.companionPort,
            pollMs: cfg.pollMs,
            protectDotObsidian: cfg.protectDotObsidian,
            announceToAgent: cfg.announceToAgent,
            autoActivate: cfg.autoActivate,
            triggerKeywords: cfg.triggerKeywords,
            enabled: cfg.enabled,
          })
        }
        case 'detect': {
          const vaults = detectVaults()
          return rpcOk(vaults.length > 0 ? vaults : { error: 'No vault found in obsidian.json' })
        }
        case 'health':
          return rpcOk(await bridge.health())
        case 'state': {
          const state = await bridge.activeState()
          return rpcOk(state)
        }
        case 'active': {
          const state = await bridge.activeState()
          if (state === null) return rpcErr(new Error('Obsidian not reachable (companion bridge or Local REST API required)'))
          return rpcOk(state)
        }
        case 'list': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { folder?: string; recursive?: boolean } | undefined
          const entries = p?.recursive ? await fs.listTree(p?.folder ?? '') : await fs.listFolder(p?.folder ?? '')
          return rpcOk(entries)
        }
        case 'read': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { path: string }
          return rpcOk({ path: p.path, content: await fs.read(p.path) })
        }
        case 'write': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { path: string; content: string }
          await fs.write(p.path, p.content)
          return rpcOk({ path: p.path })
        }
        case 'delete': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { path: string; folder?: boolean }
          if (p.folder) await fs.deleteFolder(p.path)
          else await fs.delete(p.path)
          return rpcOk({ path: p.path })
        }
        case 'move': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { source: string; target: string }
          await fs.move(p.source, p.target)
          return rpcOk({ source: p.source, target: p.target })
        }
        case 'search': {
          const fs = host.fs()
          if (fs === null) return rpcErr(new Error('Vault not configured'))
          const p = payload as { query: string; folder?: string; limit?: number }
          return rpcOk({ hits: await fs.search(p.folder ?? '', p.query, p.limit ?? 50) })
        }
        case 'applyEdit': {
          const p = payload as { path: string; from: number; to: number; text: string }
          await bridge.applyEdit(p)
          return rpcOk({ ok: true })
        }
        case 'open': {
          const p = payload as { path: string; line?: number }
          await bridge.openNote(p)
          return rpcOk({ ok: true })
        }
        case 'notice': {
          const p = payload as { message: string }
          await bridge.notice(p.message)
          return rpcOk({ ok: true })
        }
        case 'command': {
          const p = payload as { id: string }
          await bridge.executeCommand(p.id)
          return rpcOk({ ok: true })
        }
        case 'commands': {
          return rpcOk({ commands: await bridge.listCommands() })
        }
        default:
          return rpcErr(new Error(`Unknown /obsidian endpoint: ${endpoint}`))
      }
    } catch (error) {
      return rpcErr(error)
    }
  }, { authority: 'loopback' }))

  activeDispose = () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

export function apply(ctx: Context, config?: PluginConfig): void {
  // The live source the plugin reads: the settings section once the web
  // settings surface is served, the composition entry otherwise.
  current = () => config ?? DEFAULT_CONFIG
  installSettingsSection(ctx, OBSIDIAN_SETTINGS_NAMESPACE, Config, config ?? DEFAULT_CONFIG, {
    setSource: (source) => { current = source },
    onChange: () => sync(ctx),
  })
  // Initial registration from the composition entry (deployments with no
  // settings service never fire installSettingsSection hooks).
  sync(ctx)
}

/** Convenience export for tests and tooling. */
export { Config, detectVaultPath }
