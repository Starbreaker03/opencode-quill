const PART = "[\\p{L}\\p{M}]+(?:['’][\\p{L}\\p{M}]+)*"
const WORD = new RegExp(`${PART}(?:\\/${PART})?`, "gu")
const WHOLE_WORD = new RegExp(`^${PART}(?:\\/${PART})?$`, "u")
const WORD_PREFIX = new RegExp(`^${PART}(?:\\/(?:${PART})?)?$`, "u")
const WORD_END = new RegExp(`${PART}(?:\\/(?:${PART})?)?$`, "u")

export type Word = { text: string; start: number; end: number }
export type CompletionQuery = { before: string; prefix: string; next: boolean; words?: readonly Word[] }

export function normalizeWord(word: string): string {
  return word.normalize("NFC").replaceAll("’", "'").toLowerCase()
}

export function isWord(word: string): boolean {
  return WHOLE_WORD.test(word) && [...word].length <= 32
}

function isPrefix(prefix: string): boolean {
  return WORD_PREFIX.test(prefix) && [...prefix].length <= 32
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ")
}

export function maskProse(text: string): string {
  let fence: string | undefined
  let masked = text.replace(/[^\n]+/g, (line) => {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(line)?.[1]
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined
      return blank(line)
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (opening && (opening[1][0] !== "`" || !opening[2].includes("`"))) {
      fence = opening[1]
      return blank(line)
    }
    return line
  })
  masked = masked.replace(/(`+)[\s\S]*?(?:\1|$)/g, blank)
  masked = masked.replace(/(?:https?:\/\/|www\.)\S+|\[[^\]\n]*\]\([^\)\n]*\)|<[^>\n]+>/g, blank)
  masked = masked.replace(/^[ \t]*(?:[\/!$]|(?:const|let|var|function|class|import|export)\s|(?:Traceback|Error:)\b).*$/gm, blank)
  masked = masked.replace(/^(?: {4}| {0,3}\t).*$/gm, blank)
  masked = masked.replace(/\S+/g, (token) => {
    const core = token.replace(/^["“‘([{]+|["”’),;:!?}\]]+$/g, "")
    if (/[_@=\\<>-]|\d|[\p{Ll}][\p{Lu}]/u.test(core) || /^[.~]/.test(core)) return blank(token)
    if (core.includes("/") && !(core.endsWith(".") ? WHOLE_WORD.test(core.slice(0, -1)) : WORD_PREFIX.test(core))) return blank(token)
    if (/[^.]+\.[^.]+|\.\.|--/.test(core)) return blank(token)
    return token
  })
  return masked
}

export function proseWords(text: string, masked = maskProse(text)): Word[] {
  return [...masked.matchAll(WORD)]
    .filter((match) => isWord(match[0]) && masked[match.index + match[0].length] !== "/")
    .map((match) => ({ text: normalizeWord(match[0]), start: match.index, end: match.index + match[0].length }))
}

export function proseSequences(text: string): Word[][] {
  const words = proseWords(text)
  const sequences: Word[][] = []
  let previous = -1
  for (const word of words) {
    if (previous < 0 || !/^[ \t]+$/.test(text.slice(previous, word.start))) sequences.push([])
    sequences.at(-1)!.push(word)
    previous = word.end
  }
  return sequences
}

export function leftContext(before: string, words: readonly Word[] = proseWords(before)): string[] {
  const result: string[] = []
  let end = before.length
  for (let index = words.length - 1; index >= 0 && result.length < 2; index--) {
    const word = words[index]
    if (!/^[ \t]*$/.test(before.slice(word.end, end))) break
    result.unshift(word.text)
    end = word.start
  }
  return result
}

export type TextRange = readonly [start: number, end: number]

function blankRanges(text: string, ranges: readonly TextRange[]): string {
  let result = text
  for (const [start, end] of ranges) {
    if (end > start) result = result.slice(0, start) + result.slice(start, end).replace(/[^\n]/g, "\0") + result.slice(end)
  }
  return result
}

export function completionQuery(draft: string, characterOffset: number, protectedRanges: readonly TextRange[] = [], completeAtLineEnd = false): CompletionQuery | undefined {
  if (!draft.trim() || draft.length > 16_000 || characterOffset < 0 || characterOffset > draft.length ||
    (characterOffset !== draft.length && (!completeAtLineEnd || draft[characterOffset] !== "\n"))) return
  const masked = maskProse(protectedRanges.length ? blankRanges(draft, protectedRanges) : draft).slice(0, characterOffset)
  const text = draft.slice(0, characterOffset)
  const prefix = WORD_END.exec(text)?.[0]
  let end = text.length
  if (prefix) {
    const start = text.length - prefix.length
    if (masked.slice(start) !== prefix || !isPrefix(prefix)) return
    const preceding = text[start - 1]
    if (preceding && !/[ \t\n"“([{]/.test(preceding)) return
    end = start
  } else if (!/[ \t]$/.test(text)) return
  const start = Math.max(0, end - 2000)
  const before = text.slice(start, end)
  const words = proseWords(before, masked.slice(start, end))
  if (!prefix && !leftContext(before, words).length) return
  return { before, prefix: prefix ?? "", next: !prefix, words }
}
