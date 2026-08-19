import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { DEFAULT_TRIGGER_KEYWORDS, matchesTrigger, extractText, activateAgent } from '../src/activation.ts'
import { buildObsidianSkill } from '../src/skill.ts'
import { DEFAULT_CONFIG } from '../src/settings/schema.ts'
import type { ToolHost } from '../src/tools/context.ts'

describe('matchesTrigger', () => {
  it('hits on Chinese trigger words', () => {
    assert.equal(matchesTrigger('帮我在 Obsidian 记个笔记', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('把这段内容写进日记', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('搜一下知识库里关于 Rust 的内容', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('这是我的当前笔记，帮我改', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('帮我改这段选中的文本', DEFAULT_TRIGGER_KEYWORDS), true)
  })

  it('hits on English trigger words, case-insensitive', () => {
    assert.equal(matchesTrigger('sync my OBSIDIAN vault', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('update the vault index', DEFAULT_TRIGGER_KEYWORDS), true)
    assert.equal(matchesTrigger('capture this idea to journal', DEFAULT_TRIGGER_KEYWORDS), true)
  })

  it('misses unrelated messages', () => {
    assert.equal(matchesTrigger('帮我修一下这个 bug', DEFAULT_TRIGGER_KEYWORDS), false)
    assert.equal(matchesTrigger('今天天气怎么样', DEFAULT_TRIGGER_KEYWORDS), false)
    assert.equal(matchesTrigger('总结一下这段代码', DEFAULT_TRIGGER_KEYWORDS), false)
  })

  it('handles empty content and empty keyword lists', () => {
    assert.equal(matchesTrigger('', DEFAULT_TRIGGER_KEYWORDS), false)
    assert.equal(matchesTrigger('anything', []), false)
    assert.equal(matchesTrigger('anything', ['', '  ']), false)
  })

  it('respects a custom keyword list', () => {
    assert.equal(matchesTrigger('记一下这个想法', ['记一下']), true)
    assert.equal(matchesTrigger('记一下这个想法', ['别的东西']), false)
  })
})

describe('extractText', () => {
  it('extracts text from ContentBlock arrays (UserMessage shape)', () => {
    assert.equal(extractText([{ type: 'text', text: '帮我看看 obsidian vault' }]), '帮我看看 obsidian vault')
    assert.equal(extractText([{ type: 'text', text: 'obsidian' }, { type: 'image', source: {} }]), 'obsidian')
  })

  it('passes strings through and handles empty/invalid input', () => {
    assert.equal(extractText('obsidian'), 'obsidian')
    assert.equal(extractText([]), '')
    assert.equal(extractText(null), '')
    assert.equal(extractText(undefined), '')
    assert.equal(extractText(42), '')
  })

  it('joins multi-block content with spaces', () => {
    assert.equal(extractText([{ type: 'text', text: '记个' }, { type: 'text', text: '笔记' }]), '记个 笔记')
  })
})

function fakeHost(): ToolHost {
  return {
    fs: () => null,
    bridge: () => { throw new Error('bridge not used in activation test') },
    config: () => DEFAULT_CONFIG,
  }
}

function fakeAgent(): { agent: Agent; registered: string[]; sections: unknown[]; listeners: string[] } {
  const registered: string[] = []
  const sections: unknown[] = []
  const listeners: string[] = []
  const agent = {
    id: 'test-agent',
    ctx: {
      tools: {
        register: (tool: { name: string }) => {
          registered.push(tool.name)
          return () => { registered.splice(registered.indexOf(tool.name), 1) }
        },
      },
      systemPrompt: {
        section: (section: unknown) => {
          sections.push(section)
          return () => { sections.splice(sections.indexOf(section), 1) }
        },
      },
      on: (name: string) => {
        listeners.push(name)
        return () => { listeners.splice(listeners.indexOf(name), 1) }
      },
    },
  } as unknown as Agent
  return { agent, registered, sections, listeners }
}

describe('activateAgent', () => {
  it('registers all 25 tools, guidance, and approval policy into the agent scope', () => {
    const { agent, registered, sections, listeners } = fakeAgent()
    const dispose = activateAgent(agent, fakeHost)
    assert.equal(registered.length, 25)
    for (const name of [
      'obsidian_status', 'obsidian_list', 'obsidian_stat', 'obsidian_read', 'obsidian_write',
      'obsidian_edit', 'obsidian_append', 'obsidian_mkdir', 'obsidian_copy', 'obsidian_move',
      'obsidian_delete', 'obsidian_search', 'obsidian_metadata', 'obsidian_frontmatter_update',
      'obsidian_attachment_add', 'obsidian_attachment_read', 'obsidian_link_resolve',
      'obsidian_links', 'obsidian_link_insert', 'obsidian_active', 'obsidian_inline_edit',
      'obsidian_open', 'obsidian_commands_list', 'obsidian_command', 'obsidian_notice',
    ]) assert.ok(registered.includes(name), `missing tool ${name}`)
    assert.equal(sections.length, 1)
    assert.deepEqual(listeners, ['tools/pre-execute'])
    const section = sections[0] as { name: string; order: number; text: unknown }
    assert.equal(section.name, 'plugin:obsidian')
    assert.equal(typeof section.text, 'function')
    dispose()
    assert.deepEqual(registered, [])
    assert.deepEqual(sections, [])
    assert.deepEqual(listeners, [])
  })

  it('registers independently for different agents', () => {
    const a = fakeAgent()
    const b = fakeAgent()
    const disposeA = activateAgent(a.agent, fakeHost)
    const disposeB = activateAgent(b.agent, fakeHost)
    assert.equal(a.registered.length, 25)
    assert.equal(b.registered.length, 25)
    disposeA()
    assert.equal(a.registered.length, 0)
    assert.equal(b.registered.length, 25)
    disposeB()
  })
})

describe('buildObsidianSkill', () => {
  it('produces a kebab-case skill with trigger-rich description', () => {
    const skill = buildObsidianSkill()
    assert.equal(skill.name, 'obsidian')
    assert.ok(skill.description.includes('笔记'))
    assert.ok(skill.description.includes('vault'))
    assert.ok(skill.content.includes('obsidian_read'))
    assert.ok(skill.content.includes('obsidian_inline_edit'))
    assert.ok(skill.description.includes('25 个'))
    assert.ok(skill.content.includes('obsidian_attachment_add'))
    assert.ok(skill.content.includes('if_match'))
  })
})
