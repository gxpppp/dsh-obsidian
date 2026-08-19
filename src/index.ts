import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { Config, DEFAULT_CONFIG, OBSIDIAN_SETTINGS_NAMESPACE, validateConfig, type Config as PluginConfig } from './settings/schema.ts'
import { VaultFs } from './vault/vaultFs.ts'
import { detectVaultPath } from './vault/detect.ts'
import { ObsidianBridge } from './bridge/bridge.ts'
import { watchActivation, type ActivationController } from './activation.ts'
import { registerObsidianSkill } from './skill.ts'
import type { ToolHost } from './tools/context.ts'

export const inject = ['systemPrompt', 'tools']

export interface RuntimeState {
  config: () => PluginConfig
  vault: () => VaultFs | null
  bridge: () => ObsidianBridge
  activation?: ActivationController
}

function createRuntime(initial: PluginConfig): RuntimeState {
  let current = () => initial
  let vaultPath: string | undefined
  let vault: VaultFs | null = null
  let bridge: ObsidianBridge | null = null
  const state: RuntimeState = {
    config: () => current(),
    vault: () => {
      const nextPath = current().vaultPath
      if (nextPath !== vaultPath) {
        vaultPath = nextPath
        vault = nextPath ? new VaultFs(nextPath, {
          maxTextBytes: current().maxTextBytes,
          maxBinaryBytes: current().maxAttachmentBytes,
          protectedPaths: current().protectedPaths,
        }) : null
      }
      return vault
    },
    bridge: () => {
      if (bridge === null) bridge = new ObsidianBridge(() => ({
        mode: current().mode,
        vaultPath: current().vaultPath,
        companionEndpoint: current().companionEndpoint,
        companionToken: current().companionToken,
      }))
      return bridge
    },
  }
  Object.defineProperty(state, 'setConfig', { value: (source: () => PluginConfig) => { current = source; vault = null; vaultPath = undefined; bridge = null } })
  return state
}

function makeHost(ctx: Context, runtime: RuntimeState): ToolHost {
  return {
    fs: () => runtime.vault(),
    bridge: () => runtime.bridge(),
    config: () => runtime.config(),
    attachments: () => ctx.get('attachments'),
  }
}

export function apply(ctx: Context, config?: PluginConfig): void {
  const initial = config ?? DEFAULT_CONFIG
  validateConfig(initial)
  const runtime = createRuntime(initial)
  const setSource = (source: () => PluginConfig): void => {
    ;(runtime as RuntimeState & { setConfig(source: () => PluginConfig): void }).setConfig(source)
  }
  let disposeSkill: (() => void) | undefined
  const sync = (): void => {
    runtime.activation?.dispose()
    runtime.activation = undefined
    disposeSkill?.()
    disposeSkill = undefined
    const current = runtime.config()
    if (!current.enabled) return
    if (current.announceToAgent !== false) disposeSkill = registerObsidianSkill(ctx)
    if (current.autoActivate !== false) runtime.activation = watchActivation(
      ctx,
      current.triggerKeywords?.length ? current.triggerKeywords : DEFAULT_CONFIG.triggerKeywords,
      () => makeHost(ctx, runtime),
    )
  }
  installSettingsSection(ctx, OBSIDIAN_SETTINGS_NAMESPACE, Config, initial, {
    setSource,
    onChange: sync,
    validate: validateConfig,
  })
  sync()
  ctx.effect(() => () => {
    runtime.activation?.dispose()
    runtime.activation = undefined
    disposeSkill?.()
    disposeSkill = undefined
  }, 'dsh-obsidian.runtime')
}

export { Config, detectVaultPath }
export { BridgeError, ObsidianBridge } from './bridge/bridge.ts'
export { VaultFs } from './vault/vaultFs.ts'
export type { Agent }
