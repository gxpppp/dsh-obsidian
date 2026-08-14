/**
 * On-demand skill facade: ONE catalog line is always visible (name +
 * description + whenToUse); the full guidance body loads only when the model
 * or the user invokes the skill. This is the "MCP config visible, tools not
 * connected" presence — the only always-on cost of the whole integration.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

export const OBSIDIAN_SKILL_NAME = 'obsidian'

export function buildObsidianSkill(): SkillRegistration {
  return {
    name: OBSIDIAN_SKILL_NAME,
    source: 'runtime',
    description:
      '操作 Obsidian 笔记库（vault）：记笔记、写日记、搜知识库、查笔记、整理笔记、读当前笔记/选中文本、内联编辑。' +
      '触发词：obsidian、vault、笔记、日记、知识库、当前笔记、选中文本、wikilink、frontmatter。' +
      '对话涉及 Obsidian 时 obsidian_* 工具会自动可用；本技能提供完整工具清单与使用规则。',
    whenToUse:
      '用户请求涉及 Obsidian 笔记库、vault、日记/日志、知识库检索、当前笔记或编辑器选中文本时加载；' +
      '加载后按工具清单操作，工具未出现时提示用户提及 Obsidian 以激活。',
    content: `# Obsidian 集成（dsh-obsidian）

通过 obsidian_* 工具操作 Obsidian 笔记库（vault）。工具分两组：

## 文件工具（fs 通道，Obsidian 无需运行）
- obsidian_list — 列目录（可递归，点目录如 .obsidian 隐藏）
- obsidian_read — 读笔记（1-based 行号，limit 上限 2000 行）
- obsidian_write — 创建/整体替换笔记（自动建父目录）
- obsidian_edit — 字面串替换（old_string 唯一或 replace_all）
- obsidian_append — 追加（并发追加不丢字）
- obsidian_delete — 删除笔记（空目录才删）
- obsidian_move — 移动/重命名（自动建父目录）
- obsidian_search — 全文搜索（大小写不敏感，支持正则，默认 50 命中）
- obsidian_metadata — frontmatter/tags/wikilinks/大小/修改时间

## 编辑器工具（需 companion 桥或 Local REST API 且 Obsidian 运行中）
- obsidian_active — 当前活动笔记：路径、模式、选区/光标、内容
- obsidian_inline_edit — 替换编辑器当前选区（无选区时在光标处插入）
- obsidian_open — 打开笔记（可指定 1-based 行）
- obsidian_command — 按 id 触发任意 Obsidian 命令（如 editor:insert-wikilink）
- obsidian_commands_list — 列出命令 id+名称

## 意图 → 工具路由
| 用户意图 | 工具 |
|---|---|
| 查笔记/搜索知识 | obsidian_search → obsidian_read |
| 记笔记/写日记/新笔记 | obsidian_write（沿用 vault 既有命名习惯） |
| 改笔记 | obsidian_read → obsidian_edit / obsidian_append |
| 移动/重命名 | obsidian_move |
| "当前笔记/选中文本/帮我改这段" | 先 obsidian_active 取上下文，再 obsidian_read 读全文或直接 obsidian_inline_edit |
| 在 Obsidian 打开某笔记 | obsidian_open |
| 触发 Obsidian 功能 | obsidian_commands_list → obsidian_command |

## vault 规则
- 所有路径必须是 vault 相对路径：正斜杠、无前导 /、无 .. 段；.obsidian、.claudian 等点目录默认隐藏。
- wikilink（[[笔记名]]）与 frontmatter（--- 头）是 vault 的一等公民：写新笔记时尽量使用 vault 既有命名习惯。

## 内联编辑输出规范（obsidian_inline_edit）
1. 风格匹配：模仿用户的语气、缩进与标点习惯。
2. 上下文优先：修改前先用 obsidian_read 读完整文件（或足够上下文），不要只依赖选区。
3. 静默执行：工具调用不做解释，最终输出只有结果文本。
4. 选区模式用替换整段，光标模式用插入；不要输出任何包裹标签，直接给出目标文本。

## 注意
- 工具自动激活：用户消息命中触发词（obsidian/vault/笔记/日记/知识库/当前笔记…）后，本会话的 obsidian_* 工具即出现。
- 若工具尚未出现在工具列表中，先提示用户提及 Obsidian（或直接告知需要操作笔记库），激活后重试。`,
  }
}

/** Register the skill on the global layer; no-op (returns undefined) when the skills service is absent. */
export function registerObsidianSkill(ctx: Context): (() => void) | undefined {
  const skills = ctx.get('skills')
  if (skills === undefined) return undefined
  return skills.register(buildObsidianSkill())
}
