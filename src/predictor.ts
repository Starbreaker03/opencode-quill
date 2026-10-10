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
export type Prediction = { suffix: string; word: string; confidence: number }

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

export class WordPredictor {
  readonly prior = new Map<string, number>()
  private priorTotal = 0
  private personal = new PersonalModel()
  private personalTotal = 0
  private bigramTotals = new Map<string, { total: number; types: number }>()
  private trigramTotals = new Map<string, { total: number; types: number }>()
  private vocabulary: string[] = []

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

  complete(query: CompletionQuery): Prediction | undefined {
    const prefix = normalizeWord(query.prefix)
    const context = leftContext(query.before)
    const evidence = this.bigramTotals.get(context.at(-1) ?? "")?.total ?? 0
    if (query.next && evidence < 2) return
    if (!query.next && [...prefix].length < 2 && evidence < 2) return
    const local = new Map<string, number>()
    for (const word of proseWords(query.before)) increment(local, word.text)
    const candidates = new Set<string>()
    for (let index = lowerBound(this.vocabulary, prefix); index < this.vocabulary.length; index++) {
      const word = this.vocabulary[index]
      if (!word.startsWith(prefix)) break
      candidates.add(word)
    }
    for (const word of local.keys()) if (word.startsWith(prefix)) candidates.add(word)
    let best = ""
    let bestScore = 0
    let sum = 0
    for (const word of candidates) {
      const score = this.score(word, context) + (query.next ? 0 : 0.003 * Math.min(local.get(word) ?? 0, 3))
      sum += score
      if (score > bestScore) {
        best = word
        bestScore = score
      }
    }
    const confidence = query.next ? bestScore : bestScore / (sum || 1)
    if (!best || best === prefix || confidence < (query.next ? 0.55 : 0.3)) return
    let suffix = best.slice(prefix.length)
    if (query.prefix.length > 1 && query.prefix === query.prefix.toUpperCase()) suffix = suffix.toUpperCase()
    if (query.next && best === "i") suffix = "I"
    return { suffix, word: best, confidence }
  }
}
