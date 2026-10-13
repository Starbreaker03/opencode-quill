import { isWord, leftContext, normalizeWord, proseSequences, proseWords, type CompletionQuery } from "./prose"

export type Frequency = { word: string; count: number }
export type Snapshot = {
  version: 1
  words: [string, number][]
  bigrams: [string, number][]
  trigrams: [string, number][]
  seen: string[]
}
export type Prompt = { id: string; text: string }
export type Prediction = { suffix: string; word: string; confidence: number; replace?: number }

const DISCOUNT = 0.5
const PRIOR_LIMIT = 20_000
const WORD_LIMIT = 8000
const CONTEXT_LIMIT = 30_000
const SEEN_LIMIT = 8000

export function emptySnapshot(): Snapshot {
  return { version: 1, words: [], bigrams: [], trigrams: [], seen: [] }
}

function restore(rows: [string, number][], limit: number): Map<string, number> {
  return new Map(rows.slice(0, limit).filter(([word, count]) => typeof word === "string" && word.length <= 100 && Number.isFinite(count) && count > 0))
}

function trim(map: Map<string, number>, limit: number): [string, number][] {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function increment(map: Map<string, number>, word: string): void {
  map.set(word, (map.get(word) ?? 0) + 1)
}

export class PersonalModel {
  readonly words: Map<string, number>
  readonly bigrams: Map<string, number>
  readonly trigrams: Map<string, number>
  readonly seen: Set<string>

  constructor(snapshot: Snapshot = emptySnapshot()) {
    this.words = restore(snapshot.words, WORD_LIMIT)
    this.bigrams = restore(snapshot.bigrams, CONTEXT_LIMIT)
    this.trigrams = restore(snapshot.trigrams, CONTEXT_LIMIT)
    this.seen = new Set(snapshot.seen.slice(-SEEN_LIMIT))
  }

  observe(prompts: readonly Prompt[]): boolean {
    let changed = false
    for (const prompt of prompts) {
      if (this.seen.has(prompt.id)) continue
      this.seen.add(prompt.id)
      changed = true
      if (prompt.text.length > 4000 || prompt.text.split("\n").length > 12) continue
      for (const sequence of proseSequences(prompt.text)) {
        for (let index = 0; index < sequence.length; index++) {
          increment(this.words, sequence[index])
          if (index > 0) increment(this.bigrams, `${sequence[index - 1]}\0${sequence[index]}`)
          if (index > 1) increment(this.trigrams, `${sequence[index - 2]}\0${sequence[index - 1]}\0${sequence[index]}`)
        }
      }
    }
    return changed
  }

  snapshot(): Snapshot {
    return {
      version: 1,
      words: trim(this.words, WORD_LIMIT),
      bigrams: trim(this.bigrams, CONTEXT_LIMIT),
      trigrams: trim(this.trigrams, CONTEXT_LIMIT),
      seen: [...this.seen].slice(-SEEN_LIMIT),
    }
  }
}

function totals(counts: Map<string, number>): Map<string, { total: number; types: number }> {
  const result = new Map<string, { total: number; types: number }>()
  for (const [key, count] of counts) {
    const context = key.slice(0, key.lastIndexOf("\0"))
    const entry = result.get(context) ?? { total: 0, types: 0 }
    entry.total += count
    entry.types++
    result.set(context, entry)
  }
  return result
}

function lowerBound(words: readonly string[], prefix: string): number {
  let low = 0
  let high = words.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (words[middle] < prefix) low = middle + 1
    else high = middle
  }
  return low
}

function editKind(source: string, target: string, targetLength = target.length): "transpose" | "insert" | "delete" | "substitute" | undefined {
  const sourceLength = source.length
  if (Math.abs(sourceLength - targetLength) > 1) return
  let i = 0
  while (i < sourceLength && i < targetLength && source.charCodeAt(i) === target.charCodeAt(i)) i++
  if (i === sourceLength && i === targetLength) return
  if (sourceLength === targetLength) {
    if (i + 1 < sourceLength && source.charCodeAt(i) === target.charCodeAt(i + 1) && source.charCodeAt(i + 1) === target.charCodeAt(i)) {
      for (let j = i + 2; j < sourceLength; j++) if (source.charCodeAt(j) !== target.charCodeAt(j)) return
      return "transpose"
    }
    for (let j = i + 1; j < sourceLength; j++) if (source.charCodeAt(j) !== target.charCodeAt(j)) return
    return "substitute"
  }
  if (sourceLength < targetLength) {
    for (let j = i; j < sourceLength; j++) if (source.charCodeAt(j) !== target.charCodeAt(j + 1)) return
    return "insert"
  }
  for (let j = i; j < targetLength; j++) if (source.charCodeAt(j + 1) !== target.charCodeAt(j)) return
  const doubled = (i > 0 && source.charCodeAt(i) === source.charCodeAt(i - 1)) || (i + 1 < sourceLength && source.charCodeAt(i) === source.charCodeAt(i + 1))
  return doubled || sourceLength >= 5 ? "delete" : undefined
}

function typoWeight(prefix: string, word: string): number {
  const prefixLength = prefix.length
  const wordLength = word.length
  if (prefixLength < 3) return 0
  const full = editKind(prefix, word)
  if (full === "transpose") return 0.25
  if (full === "insert" || full === "delete") return prefixLength === 3 && prefix.charCodeAt(0) !== word.charCodeAt(0) ? 0 : 0.06
  if (full === "substitute") return prefixLength >= 4 && prefix.charCodeAt(0) === word.charCodeAt(0) ? 0.04 : 0
  if (prefixLength < 4 || wordLength <= prefixLength) return 0
  const head = prefix.charCodeAt(0) === word.charCodeAt(0) ||
    (prefix.charCodeAt(0) === word.charCodeAt(1) && prefix.charCodeAt(1) === word.charCodeAt(0))
  if (!head) return 0
  const partial = editKind(prefix, word, prefixLength)
  if (partial === "transpose") return 0.06
  if (partial === "substitute") return 0.02
  if (wordLength > prefixLength + 1 && editKind(prefix, word, prefixLength + 1) === "insert") return 0.03
  if (prefixLength >= 5 && editKind(prefix, word, prefixLength - 1) === "delete") return 0.02
  return 0
}

function applyCase(source: string, word: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return word.toUpperCase()
  const first = source[0]
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1)
  }
  return word === "i" ? "I" : word
}

export class WordPredictor {
  readonly prior = new Map<string, number>()
  private priorTotal = 0
  private personal = new PersonalModel()
  private personalTotal = 0
  private bigramTotals = new Map<string, { total: number; types: number }>()
  private trigramTotals = new Map<string, { total: number; types: number }>()
  private vocabulary: string[] = []
  private vocabularyByLength = new Map<number, string[]>()

  constructor(prior: readonly Frequency[]) {
    for (const { word, count } of prior) {
      const key = normalizeWord(word)
      if (!isWord(key) || !Number.isFinite(count) || count <= 0) continue
      this.prior.set(key, (this.prior.get(key) ?? 0) + count)
      this.priorTotal += count
      if (this.prior.size >= PRIOR_LIMIT) break
    }
    this.setPersonal(emptySnapshot())
  }

  setPersonal(snapshot: Snapshot): void {
    this.personal = new PersonalModel(snapshot)
    this.personalTotal = [...this.personal.words.values()].reduce((sum, count) => sum + count, 0)
    this.bigramTotals = totals(this.personal.bigrams)
    this.trigramTotals = totals(this.personal.trigrams)
    this.vocabulary = [...new Set([...this.prior.keys(), ...[...this.personal.words].filter(([, count]) => count >= 2).map(([word]) => word)])].sort()
    this.vocabularyByLength.clear()
    for (const word of this.vocabulary) {
      const words = this.vocabularyByLength.get(word.length) ?? []
      words.push(word)
      this.vocabularyByLength.set(word.length, words)
    }
  }

  private score(word: string, context: readonly string[]): number {
    const prior = (this.prior.get(word) ?? 0) / (this.priorTotal || 1)
    const personal = (this.personal.words.get(word) ?? 0) / (this.personalTotal || 1)
    const weight = this.personalTotal / (this.personalTotal + 100)
    let score = weight * personal + (1 - weight) * prior
    const previous = context.at(-1)
    const bigram = previous && this.bigramTotals.get(previous)
    if (bigram) {
      const count = this.personal.bigrams.get(`${previous}\0${word}`) ?? 0
      score = Math.max(count - DISCOUNT, 0) / bigram.total + DISCOUNT * bigram.types / bigram.total * score
    }
    const pair = context.length === 2 ? context.join("\0") : undefined
    const trigram = pair && this.trigramTotals.get(pair)
    if (trigram) {
      const count = this.personal.trigrams.get(`${pair}\0${word}`) ?? 0
      score = Math.max(count - DISCOUNT, 0) / trigram.total + DISCOUNT * trigram.types / trigram.total * score
    }
    return score
  }

  private resolveContext(raw: readonly string[], local: ReadonlyMap<string, number>): string[] {
    const resolved: string[] = []
    for (const word of raw) {
      if (this.prior.has(word) || (this.personal.words.get(word) ?? 0) >= 2 || (local.get(word) ?? 0) >= 2 || word.length < 3) {
        resolved.push(word)
        continue
      }
      let best = word
      let bestScore = 0
      for (let length = word.length - 1; length <= word.length + 1; length++) {
        for (const candidate of this.vocabularyByLength.get(length) ?? []) {
          const kind = editKind(word, candidate)
          const weight = kind === "transpose" ? 0.25 : kind ? 0.05 : 0
          if (!weight) continue
          const score = this.score(candidate, resolved) * weight
          if (score > bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
      resolved.push(best)
    }
    return resolved
  }

  complete(query: CompletionQuery): Prediction | undefined {
    const prefix = normalizeWord(query.prefix)
    const local = new Map<string, number>()
    for (const word of proseWords(query.before)) increment(local, word.text)
    const context = this.resolveContext(leftContext(query.before), local)
    const evidence = this.bigramTotals.get(context.at(-1) ?? "")?.total ?? 0
    if (query.next && evidence < 2) return
    if (!query.next && [...prefix].length < 2 && evidence < 2) return
    const candidates = new Map<string, number>()
    for (let index = lowerBound(this.vocabulary, prefix); index < this.vocabulary.length; index++) {
      const word = this.vocabulary[index]
      if (!word.startsWith(prefix)) break
      candidates.set(word, 1)
    }
    for (const word of local.keys()) if (word.startsWith(prefix)) candidates.set(word, 1)
    const suggest = (): Prediction | undefined => {
      let best = ""
      let bestScore = 0
      let bestWeight = 1
      let sum = 0
      for (const [word, weight] of candidates) {
        const base = this.score(word, context) + (query.next ? 0 : 0.003 * Math.min(local.get(word) ?? 0, 3))
        const score = base * weight
        sum += score
        if (score > bestScore) {
          best = word
          bestScore = score
          bestWeight = weight
        }
      }
      const confidence = query.next ? bestScore : bestScore / (sum || 1)
      if (!best || best === prefix || confidence < (query.next ? 0.55 : bestWeight < 1 ? 0.45 : 0.3)) return
      if (bestWeight < 1) {
        return { suffix: applyCase(query.prefix, best), word: best, confidence, replace: query.prefix.length }
      }
      let suffix = best.slice(prefix.length)
      if (query.prefix.length > 1 && query.prefix === query.prefix.toUpperCase()) suffix = suffix.toUpperCase()
      if (query.next && best === "i") suffix = "I"
      return { suffix, word: best, confidence }
    }
    const completion = suggest()
    if (completion || query.next || prefix.length < 3 || candidates.has(prefix)) return completion
    for (const [length, words] of this.vocabularyByLength) {
      if (length < prefix.length - 1) continue
      for (const word of words) {
        if (candidates.has(word)) continue
        const weight = typoWeight(prefix, word)
        if (weight > 0) candidates.set(word, weight)
      }
    }
    for (const word of local.keys()) {
      if (candidates.has(word)) continue
      const weight = typoWeight(prefix, word)
      if (weight > 0) candidates.set(word, weight)
    }
    return suggest()
  }
}
