import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { BridgeError } from '../bridge/bridge.ts'
import type { ToolHost } from './context.ts'

export function text(textValue: string): ContentBlock[] {
  return [{ type: 'text', text: textValue }]
}

export function openObjectOutput(render: (value: Record<string, JsonValue>) => string) {
  return {
    schema: { type: 'object' as const, additionalProperties: true as const },
    render: (_args: unknown, value: Record<string, JsonValue>) => text(render(value)),
  }
}

export function jsonOutput(render?: (value: JsonValue) => string) {
  return {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: JsonValue) => text(render ? render(value) : JSON.stringify(value, null, 2)),
  }
}

export function compact(value: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, item as JsonValue]),
  )
}

export function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function canUseOfflineFallback(host: ToolHost, error: unknown): boolean {
  return host.config().mode === 'auto'
    && error instanceof BridgeError
    && (error.code === 'UNREACHABLE' || error.code === 'TIMEOUT')
}

export function safeModelText(value: unknown, maxLength = 4000): string {
  const source = typeof value === 'string' ? value : String(value ?? '')
  return source.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maxLength)
}
