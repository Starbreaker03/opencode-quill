const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
const WHOLE_WORD = /^[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*$/u
const WORD_END = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*$/u

export type Word = { text: string; start: number; end: number }
export type CompletionQuery = { before: string; prefix: string; next: boolean; words?: readonly Word[] }

export function normalizeWord(word: string): string {
  return word.normalize("NFC").replaceAll("’", "'").toLowerCase()
}

export function isWord(word: string): boolean {
  return WHOLE_WORD.test(word) && [...word].length <= 32
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ")
}

export function maskProse(text: string): string {
  let masked = text.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, blank)
  masked = masked.replace(/(`+)[\s\S]*?(?:\1|$)/g, blank)
  masked = masked.replace(/(?:https?:\/\/|www\.)\S+|\[[^\]\n]*\]\([^\)\n]*\)|<[^>\n]+>/g, blank)
  masked = masked.replace(/^[ \t]*(?:[\/!$]|(?:const|let|var|function|class|import|export)\s|(?:Traceback|Error:)\b).*$/gm, blank)
  masked = masked.replace(/^ {4,}.*$/gm, blank)
  masked = masked.replace(/\S+/g, (token) => {
    const core = token.replace(/^["“‘([{]+|["”’),;:!?}\]]+$/g, "")
    if (/[\/_@=\\<>-]|\d|[\p{Ll}][\p{Lu}]/u.test(core) || /^[.~]/.test(core)) return blank(token)
    if (/[^.]+\.[^.]+|\.\.|--/.test(core)) return blank(token)
    return token
  })
  return masked
}

export function proseWords(text: string, masked = maskProse(text)): Word[] {
  return [...masked.matchAll(WORD)]
    .filter((match) => isWord(match[0]))
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

export function completionQuery(text: string, characterOffset: number): CompletionQuery | undefined {
  if (!text.trim() || characterOffset !== text.length || text.length > 16_000) return
  const masked = maskProse(text)
  const prefix = WORD_END.exec(text)?.[0]
  let end = text.length
  if (prefix) {
    const start = text.length - prefix.length
    if (masked.slice(start) !== prefix || !isWord(prefix)) return
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
