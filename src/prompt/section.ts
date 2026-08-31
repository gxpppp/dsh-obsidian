export const SECTION_ORDER = 3000

export function buildObsidianGuidance(vaultPath: string | undefined, mode: string): string {
  const vaultLine = vaultPath ? `Vault root is configured: ${vaultPath}.` : 'Vault root is not configured.'
  return `本机已安装 dsh-obsidian：${vaultLine}
通道模式：${mode}（fs=安全直读 vault；companion=Obsidian 原生 API 与编辑器；auto=优先 companion，必要时只对可安全降级的操作回到 fs）。
- 工具按当前 agent 按需注入，共 25 个：status、list/stat/read/write/edit/append/mkdir/copy/move/delete、search/metadata/frontmatter_update、attachment_add/attachment_read、link_resolve/links/link_insert、active/inline_edit/open/commands_list/command/notice。
- 所有路径必须是 vault 相对路径；绝对路径、..、dot-directory、symlink/junction 逃逸一律拒绝。
- 更新工具优先使用 obsidian_read 返回的 revision，并传 if_match；冲突时重新读取，不能覆盖用户并发修改。
- 编辑器工具使用 companion 返回的 path、revision、selection offsets 和 expected text；companion 不可用时不要假装成功。
- 任意命令执行受 commandPolicy 与 DSH approval 控制；永久删除也需要显式参数和审批。
- frontmatter、metadata cache、backlinks、unresolved links、Obsidian-generated links 和附件语义以 companion 原生 API 为准。`
}

export function buildInlineEditRules(): string {
  return `当执行 obsidian_inline_edit 时：
1. 先用 obsidian_active 获取当前 revision 和选区，再按需要读取完整文件上下文。
2. 选区模式替换整段，光标模式在 cursor offset 插入；让 companion 校验 expected text，遇到冲突先重读。
3. 保持用户原有语气、缩进和标点；最终只输出替换结果，不输出包裹标签。`
}
