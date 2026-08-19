import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolHost } from './context.ts'
import { registerAttachmentTools } from './attachmentTools.ts'
import { registerKnowledgeTools } from './knowledgeTools.ts'
import { registerLinkInsertTool } from './linkInsertTool.ts'
import { registerVaultTools } from './vaultTools.ts'

export function registerFileTools(host: ToolHost): ToolDefinition[] {
  return [
    ...registerVaultTools(host),
    ...registerKnowledgeTools(host),
    ...registerAttachmentTools(host),
    ...registerLinkInsertTool(host),
  ]
}
