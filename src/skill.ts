import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

export const OBSIDIAN_SKILL_NAME = 'obsidian'

export function buildObsidianSkill(): SkillRegistration {
  return {
    name: OBSIDIAN_SKILL_NAME,
    source: 'runtime',
    description:
      '操作 Obsidian vault：读写笔记、搜索知识、编辑当前选区、管理 frontmatter、附件和链接。' +
      '触发词：obsidian、vault、笔记、日记、知识库、当前笔记、选中文本、wikilink、frontmatter、附件、backlink。' +
      '对话涉及 Obsidian 时，25 个 obsidian_* 工具会按 agent 按需出现。',
    whenToUse:
      '用户请求涉及 Obsidian 笔记库、vault、日记、知识库检索、当前笔记、编辑器选区、附件或链接图时加载。' +
      '工具未出现时，先让用户在消息中明确提及 Obsidian 或笔记库。',
    content: `# Obsidian 集成（dsh-obsidian）

工具只注入当前触发它们的 agent，不会污染其他会话。所有路径都是 vault 相对路径；受保护的点目录、绝对路径、symlink/junction 逃逸都会被拒绝。更新工具返回 SHA-256 revision，修改已有内容时优先传 if_match。

## 工具清单

### Vault（Obsidian 可关闭）
- obsidian_status — 通道、协议、能力和 vault 身份状态
- obsidian_list / obsidian_stat / obsidian_read — 浏览、属性和带 revision 的读取
- obsidian_write / obsidian_edit / obsidian_append — 原子写入、精确替换和串行追加
- obsidian_mkdir / obsidian_copy / obsidian_move / obsidian_delete — 目录、复制、移动和 trash；永久删除需要审批

### 知识语义
- obsidian_search — literal、regex 或 path 搜索，支持 folder、扩展名、tag、property、cursor 分页
- obsidian_metadata — frontmatter、tags、headings、blocks、links、embeds 和 revision
- obsidian_frontmatter_update — 通过 Obsidian processFrontMatter 更新属性
- obsidian_link_resolve / obsidian_links / obsidian_link_insert — 解析、出链/反向链接/未解析链接和生成链接

### 附件
- obsidian_attachment_add — DSH durable image ref 或 vault 相对路径导入；不接受主机绝对路径/URL
- obsidian_attachment_read — 读取附件元数据，图片可发布为 DSH durable ref

### 编辑器与命令（需要 companion）
- obsidian_active — 活动笔记、revision、精确选区/光标和 open tabs
- obsidian_inline_edit — 校验 path、revision、offsets、expected text 后替换
- obsidian_open — 打开笔记并定位到行
- obsidian_commands_list / obsidian_command — 枚举和执行命令；受 commandPolicy 与审批控制
- obsidian_notice — 在 Obsidian 中显示短通知

## 路由规则
- 查笔记：obsidian_search → obsidian_read → obsidian_metadata。
- 写新笔记：先 obsidian_list 了解命名，再 obsidian_write。
- 修改已有文件：先 obsidian_read 获取 revision，再传 if_match 给 obsidian_edit/write/frontmatter_update。
- 当前笔记或选中文本：obsidian_active → obsidian_read（需要上下文时）→ obsidian_inline_edit。
- 链接工作流：obsidian_link_resolve / obsidian_links；插入用 obsidian_link_insert。
- Obsidian 关闭时，编辑器、命令、metadata cache、backlinks 和 processFrontMatter 工具必须明确报告 companion 不可用，不伪造降级结果。

## 内联编辑规则
1. 先读取足够上下文，保持用户语气、缩进和标点。
2. 使用 selection 的 expected text 与 revision，遇到 CONFLICT 先重新读取，不覆盖用户并发编辑。
3. 工具调用保持安静，最终只输出结果文本，不添加包裹标签。
`,
  }
}

export function registerObsidianSkill(ctx: Context): (() => void) | undefined {
  const skills = ctx.get('skills')
  if (skills === undefined) return undefined
  return skills.register(buildObsidianSkill())
}
