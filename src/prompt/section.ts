/**
 * System-prompt section announcing the Obsidian integration to every agent
 * (port of Claudian's agent-workspace guidance + inline-edit prompt rules).
 */

export const SECTION_ORDER = 300

export function buildObsidianGuidance(vaultPath: string | undefined, mode: string): string {
  const vaultLine = vaultPath ? `Vault root: ${vaultPath}.` : 'Vault root: not configured yet.'
  return `本机已安装 dsh-obsidian 插件（Claudian 交互能力移植）：${vaultLine}
通道模式: ${mode}（fs=直读 vault 目录 / companion=Obsidian 桥插件 / rest=Local REST API / auto=自动）。
能力与规则：
- 所有 vault 路径必须是 vault 相对路径（正斜杠，无前导 /，无 .. 段）；.obsidian、.claudian 等点目录默认隐藏。
- 文件工具：obsidian_list / obsidian_read / obsidian_write / obsidian_edit / obsidian_append / obsidian_delete / obsidian_move / obsidian_search / obsidian_metadata。
- 编辑器工具（需 companion 桥或 Local REST API 且 Obsidian 运行中）：obsidian_active 读取当前活动笔记与选区/光标上下文；obsidian_inline_edit 将替换文本直接写回 Obsidian 编辑器的当前选区；obsidian_open 打开笔记（可指定行）；obsidian_command 按 id 触发任意 Obsidian 命令；obsidian_search 可用 Obsidian 索引搜索。
- 用户提及"当前笔记/选中文本/帮我改这段"时，先调 obsidian_active 取上下文，再决定读取完整文件或直接内联编辑。
- 内联编辑输出规范：只输出最终文本，不要客套语；保持用户语气与排版；替换内容应与选区语义一致。
- wikilink（[[笔记名]]）与 frontmatter（--- 头）是 vault 的一等公民：写新笔记时尽量使用 vault 既有命名习惯。`
}

export function buildInlineEditRules(): string {
  return `当执行内联编辑时：
1. 风格匹配：模仿用户的语气、缩进与标点习惯。
2. 上下文优先：修改前先用 obsidian_read 读完整文件（或足够上下文），不要只依赖选区。
3. 静默执行：工具调用不做解释，最终输出只有结果文本。
4. 选区模式用替换整段，光标模式用插入；不要输出任何包裹标签，直接给出目标文本。`
}
