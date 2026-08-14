import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCursorContext,
  buildSelectionContext,
  formatEditorContextXml,
  selectionContextToJson,
} from '../src/vault/editorContext.ts'

const DOC = 'line one\nline two\nline three\n'

describe('buildSelectionContext', () => {
  it('builds a selection context from offsets', () => {
    // select "two" on line 2 (0-indexed line 1): offsets 14-17
    const ctx = buildSelectionContext('notes/a.md', DOC, 14, 17)
    assert.equal(ctx.mode, 'selection')
    assert.equal(ctx.selectedText, 'two')
    assert.equal(ctx.startLine, 2)
    assert.equal(ctx.lineCount, 1)
  })

  it('builds a cursor context when from === to', () => {
    const ctx = buildSelectionContext('notes/a.md', DOC, 5, 5)
    assert.equal(ctx.mode, 'cursor')
    assert.equal(ctx.cursorContext?.line, 0)
    assert.equal(ctx.cursorContext?.column, 5)
  })
})

describe('buildCursorContext', () => {
  it('classifies an empty-line cursor as inbetween with neighbors', () => {
    const doc = 'alpha\n\nbeta\n'
    const getLine = (line: number) => doc.split('\n')[line]
    const ctx = buildCursorContext(getLine, 3, 1, 0)
    assert.equal(ctx.isInbetween, true)
    assert.equal(ctx.beforeCursor, 'alpha')
    assert.equal(ctx.afterCursor, 'beta')
  })
})

describe('formatEditorContextXml', () => {
  it('renders selection with CDATA', () => {
    const ctx = buildSelectionContext('notes/a.md', DOC, 14, 17)
    const xml = formatEditorContextXml(ctx)
    assert.ok(xml.includes('<editor_selection path="notes/a.md" lines="2-2">'))
    assert.ok(xml.includes('<![CDATA[two]]>'))
  })

  it('escapes XML attributes and splits CDATA terminators', () => {
    const ctx = buildSelectionContext('a"b.md', 'x<y ]]>\nz', 0, 8)
    const xml = formatEditorContextXml(ctx)
    assert.ok(xml.includes('path="a&quot;b.md"'))
    // Claudian parity: a raw ']]>' is split via the ]]]]><![CDATA[> idiom.
    assert.ok(xml.includes(']]]]><![CDATA[>'))
    assert.ok(xml.includes('x<y ]]'))
  })
})

describe('selectionContextToJson', () => {
  it('produces the wire payload', () => {
    const ctx = buildSelectionContext('notes/a.md', DOC, 14, 17)
    const json = selectionContextToJson(ctx)
    assert.equal(json.path, 'notes/a.md')
    assert.equal(json.mode, 'selection')
    assert.equal(json.selectedText, 'two')
  })
})
