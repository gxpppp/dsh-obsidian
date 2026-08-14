/**
 * Host services handed to the tool registrars.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Config } from '../settings/schema.ts'
import type { ObsidianBridge } from '../bridge/bridge.ts'
import type { VaultFs } from '../vault/vaultFs.ts'

export interface ToolHost {
  /** Lazy vault filesystem (null when vaultPath is not configured). */
  fs: () => VaultFs | null
  /** Bridge client (companion/rest channels). */
  bridge: () => ObsidianBridge
  /** Current plugin config. */
  config: () => Config
}

/** Build a text content block (the only block kind these tools emit). */
export function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

/** Fail with a readable error when the vault is not configured. */
export function requireFs(host: ToolHost): VaultFs {
  const fs = host.fs()
  if (fs === null) {
    throw new Error('Obsidian vault is not configured: set vaultPath in the plugin settings (or click "detect vault")')
  }
  return fs
}
