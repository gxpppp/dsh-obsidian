/**
 * Editor selection/cursor context (port of Claudian's utils/editor.ts).
 *
 * The companion bridge reports raw offsets; this module builds the same
 * semantic context Claudian builds (selection vs cursor vs none, cursor
 * surroundings, #inline / #inbetween classification) and renders it either as
 * the XML tags Claudian uses (`<editor_selection>` / `<editor_cursor>` with
 * CDATA) or as a plain JSON payload for tool results.
 */

export interface CursorContext {
  beforeCursor: string
  afterCursor: string
  /** True when the cursor sits on an empty line or between blank surroundings. */
  isInbetween: boolean
  /** 0-indexed line. */
  line: number
  /** 0-indexed column. */
  column: number
}

export interface EditorSelectionContext {
  /** Vault-relative note path. */
  notePath: string
  mode: 'selection' | 'cursor' | 'none'
  selectedText?: string
  /** 1-indexed start line of the selection. */
  startLine?: number
  /** Number of lines in the selection. */
  lineCount?: number
  cursorContext?: CursorContext
  /** The full document text (optional; used by tools that need it). */
  fullText?: string
}

export function findNearestNonEmptyLine(
  getLine: (line: number) => string,
  lineCount: number,
  startLine: number,
  direction: 'before' | 'after',
): string {
  const step = direction === 'before' ? -1 : 1
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i)
    if (content.trim().length > 0) return content
  }
  return ''
}

/** All line/column params are 0-indexed (Claudian parity). */
export function buildCursorContext(
  getLine: (line: number) => string,
  lineCount: number,
  line: number,
  column: number,
): CursorContext {
  const lineContent = getLine(line)
  const beforeCursor = lineContent.substring(0, column)
  const afterCursor = lineContent.substring(column)

  const lineIsEmpty = lineContent.trim().length === 0
  const nothingBefore = beforeCursor.trim().length === 0
  const nothingAfter = afterCursor.trim().length === 0
  const isInbetween = lineIsEmpty || (nothingBefore && nothingAfter)

  let contextBefore = beforeCursor
  let contextAfter = afterCursor

  if (isInbetween) {
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, 'before')
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, 'after')
  }

  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column }
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapCdata(value: string): string {
  return value.includes(']]>')
    ? value.split(']]>').join(']]]]><![CDATA[>')
    : value
}

/** Render the context as Claudian-style XML tags. */
export function formatEditorContextXml(context: EditorSelectionContext): string {
  if (context.mode === 'selection' && context.selectedText !== undefined) {
    const lineAttr = context.startLine && context.lineCount
      ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"`
      : ''
    return `<editor_selection path="${escapeXmlAttribute(context.notePath)}"${lineAttr}>\n<![CDATA[${wrapCdata(context.selectedText)}]]>\n</editor_selection>`
  }
  if (context.mode === 'cursor' && context.cursorContext) {
    const ctx = context.cursorContext
    let content: string
    if (ctx.isInbetween) {
      const parts: string[] = []
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor)
      parts.push('| #inbetween')
      if (ctx.afterCursor) parts.push(ctx.afterCursor)
      content = parts.join('\n')
    } else {
      content = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`
    }
    return `<editor_cursor path="${escapeXmlAttribute(context.notePath)}" line="${ctx.line + 1}">\n<![CDATA[${wrapCdata(content)}]]>\n</editor_cursor>`
  }
  return ''
}

/** Build a selection context from raw offsets over a document. */
export function buildSelectionContext(
  notePath: string,
  fullText: string,
  from: number,
  to: number,
): EditorSelectionContext {
  const lines = fullText.split('\n')
  const lineCount = lines.length
  const getLine = (line: number): string => (line >= 0 && line < lineCount ? lines[line] : '')
  const posOf = (offset: number): { line: number; col: number } => {
    let remaining = Math.max(0, Math.min(offset, fullText.length))
    for (let i = 0; i < lineCount; i++) {
      if (remaining <= lines[i].length) return { line: i, col: remaining }
      remaining -= lines[i].length + 1
    }
    return { line: lineCount - 1, col: lines[lineCount - 1]?.length ?? 0 }
  }

  if (from === to) {
    const pos = posOf(from)
    return {
      notePath,
      mode: 'cursor',
      cursorContext: buildCursorContext(getLine, lineCount, pos.line, pos.col),
      fullText,
    }
  }
  const start = posOf(from)
  const end = posOf(to)
  return {
    notePath,
    mode: 'selection',
    selectedText: fullText.slice(from, to),
    startLine: start.line + 1,
    lineCount: end.line - start.line + 1,
    fullText,
  }
}

/** JSON payload form used by tool results and the GUI. */
export function selectionContextToJson(context: EditorSelectionContext): Record<string, unknown> {
  return {
    path: context.notePath,
    mode: context.mode,
    ...(context.mode === 'selection' ? {
      selectedText: context.selectedText,
      startLine: context.startLine,
      lineCount: context.lineCount,
    } : {}),
    ...(context.mode === 'cursor' && context.cursorContext ? {
      cursor: context.cursorContext,
    } : {}),
  }
}
