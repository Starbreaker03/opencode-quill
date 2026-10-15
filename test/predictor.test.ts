import { expect, test } from "bun:test"
import frequencies from "subtlex-word-frequencies"
import { emptySnapshot, PersonalModel, WordPredictor } from "../src/predictor"
import { completionQuery } from "../src/prose"

function complete(predictor: WordPredictor, text: string) {
  return predictor.complete(completionQuery(text, text.length)!)
}

test("cold-start completion uses the licensed vocabulary without history", () => {
  const predictor = new WordPredictor(frequencies)
  expect(complete(predictor, "pleas")?.suffix).toBe("e")
  expect(complete(predictor, "PLEAS")?.suffix).toBe("E")
  expect(complete(predictor, "Pleas")?.suffix).toBe("e")
  expect(complete(predictor, "the")).toBeUndefined()
  expect(complete(predictor, "please ")).toBeUndefined()
  expect(complete(predictor, "p")).toBeUndefined()
})

test("hides a learned fragment behind a longer learned word used at least as often", () => {
  const model = new PersonalModel()
  const predictor = new WordPredictor([])
  const prompts = (text: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: `${text}${index}`, text }))
  model.observe([...prompts("fix addr", 3), ...prompts("it was addressed", 4)])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "add")?.word).toBe("addressed")
  model.observe(prompts("see addr again", 5))
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "add")?.word).toBe("addr")
})

test("completes learned words with their usual mid-sentence casing", () => {
  const model = new PersonalModel()
  const predictor = new WordPredictor([])
  model.observe([
    { id: "1", text: "ask Ozan today" }, { id: "2", text: "ping Ozan now" },
    { id: "3", text: "Please ship it" }, { id: "4", text: "Please ship it" }, { id: "5", text: "please ship it" },
  ])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "ask Oz")).toMatchObject({ suffix: "an", word: "ozan" })
  expect(complete(predictor, "ask oz")).toMatchObject({ suffix: "Ozan", replace: 2 })
  expect(complete(predictor, "ask OZ")?.suffix).toBe("AN")
  expect(complete(predictor, "pl")?.suffix).toBe("ease")
})

test("halves learned counts once the model exceeds its size budget", () => {
  const model = new PersonalModel()
  const text = Array.from({ length: 10 }, () => Array(130).fill("go").join(" ")).join("\n")
  model.observe(Array.from({ length: 80 }, (_, index) => ({ id: String(index), text })))
  expect(model.words.get("go")).toBe(52_000)
  expect(model.bigrams.get("go\0go")).toBe(51_600)
  model.observe([{ id: "rare", text: "solo word" }])
  expect(model.words.get("solo")).toBe(1)
})

test("trigram context disambiguates completions and predicts following words", () => {
  const model = new PersonalModel()
  model.observe([
    { id: "1", text: "please run tests" }, { id: "2", text: "please run tests" },
    { id: "3", text: "please write text" }, { id: "4", text: "please write text" },
  ])
  const predictor = new WordPredictor([{ word: "tests", count: 1 }, { word: "text", count: 1 }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please run te")?.suffix).toBe("sts")
  expect(complete(predictor, "please write te")?.suffix).toBe("xt")
  expect(complete(predictor, "please run ")?.suffix).toBe("tests")
  expect(complete(predictor, "please write ")?.suffix).toBe("text")
})

test("learns new prose vocabulary only after repeated use", () => {
  const model = new PersonalModel()
  const predictor = new WordPredictor([])
  model.observe([{ id: "1", text: "please revise quillish" }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "quill")).toBeUndefined()
  model.observe([{ id: "2", text: "please revise quillish" }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "quill")?.suffix).toBe("ish")
  expect(complete(predictor, "please revise q")?.suffix).toBe("uillish")
})

test("prompt-local vocabulary is usable without being persisted", () => {
  const predictor = new WordPredictor([])
  expect(complete(predictor, "quillish please revise qui")?.suffix).toBe("llish")
})

test("keeps complete words as candidates instead of forcing a longer word", () => {
  const predictor = new WordPredictor([{ word: "the", count: 1000 }, { word: "there", count: 1 }])
  expect(complete(predictor, "the")).toBeUndefined()
  expect(complete(predictor, "ther")?.suffix).toBe("e")
})

test("deduplicates submitted messages across persistent model restores", () => {
  const prompts = [{ id: "session:1", text: "please run tests" }]
  const model = new PersonalModel()
  expect(model.observe(prompts)).toBe(true)
  const snapshot = model.snapshot()
  const restored = new PersonalModel(JSON.parse(JSON.stringify(snapshot)))
  expect(restored.observe(prompts)).toBe(false)
  expect(restored.snapshot()).toEqual(snapshot)
  expect(restored.words.get("tests")).toBe(1)
})

test("ignores code, paths, assistant-free fixtures, and oversized pastes", () => {
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "please run `secretCode` src/private.ts tests" }, { id: "2", text: "secret ".repeat(1000) }])
  expect([...model.words.keys()]).toEqual(["please", "run", "tests"])
  expect(model.bigrams.has("run\0tests")).toBe(false)
  expect(model.words.has("secret")).toBe(false)
  expect(model.snapshot().seen).toEqual(["1", "2"])
})

test("handles normalized Unicode without replacing the typed prefix", () => {
  const predictor = new WordPredictor([{ word: "réviser", count: 10 }, { word: "請修正", count: 10 }])
  expect(complete(predictor, "re\u0301")?.suffix).toBe("viser")
  expect(complete(predictor, "請修")?.suffix).toBe("正")
})

test("a blank snapshot is durable JSON without raw prompt text", () => {
  const model = new PersonalModel(emptySnapshot())
  model.observe([{ id: "1", text: "please run tests" }])
  expect(JSON.stringify(model.snapshot())).not.toContain("please run tests")
})

test("does not inflate next-word confidence when rare learned words are withheld", () => {
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "please choose quillish" }, { id: "2", text: "please choose quillous" }])
  const predictor = new WordPredictor([{ word: "the", count: 1000 }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please choose ")).toBeUndefined()
})

test("corrects current-word typos and mistyped prefixes while preserving casing", () => {
  const predictor = new WordPredictor(frequencies)
  expect(complete(predictor, "teh")).toMatchObject({ suffix: "the", word: "the", replace: 3 })
  expect(complete(predictor, "Teh")).toMatchObject({ suffix: "The", word: "the", replace: 3 })
  expect(complete(predictor, "TEH")).toMatchObject({ suffix: "THE", word: "the", replace: 3 })
  expect(complete(predictor, "pleae")).toMatchObject({ suffix: "please", word: "please", replace: 5 })
  expect(complete(predictor, "lpease")).toMatchObject({ suffix: "please", word: "please", replace: 6 })
  expect(complete(predictor, "becua")).toMatchObject({ suffix: "because", word: "because", replace: 5 })
})

test("prefers confident prefix completions to typo replacements with the bundled vocabulary", () => {
  const predictor = new WordPredictor(frequencies)
  for (const [prefix, word] of [["whate", "whatever"], ["cann", "cannot"], ["wat", "watch"], ["mee", "meet"], ["nad", "nada"]]) {
    expect(complete(predictor, prefix)).toMatchObject({ suffix: word.slice(prefix.length), word })
    expect(complete(predictor, prefix)?.replace).toBeUndefined()
  }
})

test("repairs left-context typos after a single learned occurrence", () => {
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "please run tests" }, { id: "2", text: "please run tests" }])
  const predictor = new WordPredictor(frequencies)
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please rnu ")?.suffix).toBe("tests")
  model.observe([{ id: "3", text: "please rnu tests" }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please rnu ")?.suffix).toBe("tests")
  expect(complete(predictor, "please rnu te")?.suffix).toBe("sts")
})

test("refreshes learned typo candidates when the personal model is cleared", () => {
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "quillish" }, { id: "2", text: "quillish" }])
  const predictor = new WordPredictor([])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "quillsh")).toMatchObject({ word: "quillish", suffix: "quillish", replace: 7 })
  predictor.setPersonal(emptySnapshot())
  expect(complete(predictor, "quillsh")).toBeUndefined()
})

test("does not replace short technical tokens with English near-matches", () => {
  const predictor = new WordPredictor(frequencies)
  for (const token of ["json", "yaml", "bool", "opts", "enum"]) {
    expect(complete(predictor, token)).toBeUndefined()
  }
})

test("abstains on short mistyped prefixes and can correct a learned technical word", () => {
  const predictor = new WordPredictor(frequencies)
  expect(complete(predictor, "fucn")).toBeUndefined()
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "func" }, { id: "2", text: "func" }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "fucn")).toMatchObject({ word: "func", suffix: "func", replace: 4 })
})

test("keeps typo penalties in confidence even with a single candidate", () => {
  const predictor = new WordPredictor([{ word: "please", count: 1 }])
  const prediction = complete(predictor, "pleae")
  expect(prediction).toMatchObject({ word: "please", replace: 5 })
  expect(prediction!.confidence).toBeLessThanOrEqual(0.06)
  const lessLikely = new WordPredictor([{ word: "please", count: 1 }, { word: "unrelated", count: 9999 }])
  expect(complete(lessLikely, "pleae")?.confidence).toBeCloseTo(0.06 / 10000, 10)
  const weak = new WordPredictor([{ word: "please", count: 1 }, { word: "unrelated", count: 1_000_000 }])
  expect(complete(weak, "pleae")).toBeUndefined()
})

test("allows supported partial edits without requiring a monopoly on candidates", () => {
  for (const [prefix, word] of [["outsx", "outside"], ["pleaas", "pleased"]]) {
    const predictor = new WordPredictor([{ word, count: 1 }])
    expect(complete(predictor, prefix)).toMatchObject({ word, suffix: word, replace: prefix.length })
  }
  const predictor = new WordPredictor([{ word: "pleased", count: 1 }, { word: "pleases", count: 1 }])
  expect(complete(predictor, "pleae")).toMatchObject({ word: "pleased", replace: 5 })
  const weak = new WordPredictor([{ word: "outside", count: 1 }, { word: "unrelated", count: 1_000_000 }])
  expect(complete(weak, "outsx")).toBeUndefined()
})

test("does not replace coding vocabulary, plurals, or inflections with nearby stems", () => {
  const predictor = new WordPredictor(frequencies)
  for (const word of [
    "plugin", "refactor", "refactors", "prompts", "predicts", "inserts", "replaces", "rewrites",
    "helpers", "folders", "buffers", "builders", "wrappers", "trackers", "bundler", "handlers",
    "routers", "matchers", "linters", "tester",
  ]) {
    expect(complete(predictor, word)).toBeUndefined()
  }
  for (const [prefix, bad] of [["arent", "aren"], ["doesnt", "doesn"], ["wasnt", "want"]]) {
    expect(complete(predictor, prefix)?.word).not.toBe(bad)
  }
  expect(complete(predictor, "pleaase")).toMatchObject({ word: "please", replace: 7 })
})

test("corrects missing apostrophes in learned contractions", () => {
  for (const [prefix, word] of [["dont", "don't"], ["cant", "can't"], ["wont", "won't"], ["ive", "i've"]]) {
    const model = new PersonalModel()
    model.observe([{ id: "1", text: word }, { id: "2", text: word }])
    const predictor = new WordPredictor([])
    predictor.setPersonal(model.snapshot())
    expect(complete(predictor, prefix)).toMatchObject({ word, suffix: word === "i've" ? "I've" : word, replace: prefix.length })
  }
})

test("capitalizes lowercase first-person contraction prefixes on acceptance", () => {
  for (const [prefix, word] of [["i'v", "i've"], ["i'l", "i'll"]]) {
    const model = new PersonalModel()
    model.observe([{ id: "1", text: word }, { id: "2", text: word }])
    const predictor = new WordPredictor([])
    predictor.setPersonal(model.snapshot())
    expect(complete(predictor, prefix)).toMatchObject({ word, suffix: `I${word.slice(1)}`, replace: prefix.length })
  }
})

test("capitalizes a single lowercase i before a learned contraction", () => {
  for (const word of ["i'm", "i'll", "i've", "i'd"]) {
    const model = new PersonalModel()
    model.observe([{ id: "1", text: `think ${word}` }, { id: "2", text: `think ${word}` }])
    const predictor = new WordPredictor([])
    predictor.setPersonal(model.snapshot())
    expect(complete(predictor, "think i")).toMatchObject({ word, suffix: `I${word.slice(1)}`, replace: 1 })
    expect(predictor.complete({ before: "think ", prefix: "i", next: false })).toEqual(complete(predictor, "think i"))
  }
})

test("does not repair technical context words into learned English continuations", () => {
  for (const [token, candidate] of [
    ["dir", "did"], ["res", "yes"], ["env", "end"], ["vim", "him"],
    ["api", "ape"], ["cli", "eli"], ["tui", "tub"], ["url", "curl"],
    ["init", "unit"], ["auth", "ruth"], ["json", "jason"], ["yaml", "yams"],
  ]) {
    const model = new PersonalModel()
    model.observe([{ id: "1", text: `${candidate} tests` }, { id: "2", text: `${candidate} tests` }])
    const predictor = new WordPredictor(frequencies)
    predictor.setPersonal(model.snapshot())
    expect(complete(predictor, `check ${token} `)).toBeUndefined()
  }
})

test("requires repeated continuation evidence before repairing context", () => {
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "please run tests" }])
  const predictor = new WordPredictor(frequencies)
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please rnu te")).toEqual(complete(predictor, "please abcdefghijklmnop te"))
  model.observe([{ id: "2", text: "please run tests" }])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please rnu te")?.suffix).toBe("sts")
  expect(complete(predictor, "please rnu te")).not.toEqual(complete(predictor, "please abcdefghijklmnop te"))
})

test("does not repair context when supported alternatives are ambiguous", () => {
  const model = new PersonalModel()
  model.observe(["abxcde", "abycde", "abzcde"].flatMap((word, index) => [
    { id: `${index}:1`, text: `${word} tests` }, { id: `${index}:2`, text: `${word} tests` },
  ]))
  const predictor = new WordPredictor([])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "check abcde ")).toBeUndefined()
})

test("capitalizes first-person contractions in corrections and next-word predictions", () => {
  for (const word of ["i'm", "i'll", "i've", "i'd"]) {
    const model = new PersonalModel()
    model.observe([{ id: "1", text: `please ${word} go` }, { id: "2", text: `please ${word} go` }])
    const predictor = new WordPredictor([{ word, count: 10 }])
    predictor.setPersonal(model.snapshot())
    expect(complete(predictor, "please ")?.suffix).toBe(`I${word.slice(1)}`)
  }
  const predictor = new WordPredictor([{ word: "i'm", count: 10 }])
  expect(complete(predictor, "i'mm")).toMatchObject({ word: "i'm", suffix: "I'm", replace: 4 })
})

test("predicts next words and disambiguates current words across a typo in left context", () => {
  const model = new PersonalModel()
  model.observe([
    { id: "1", text: "please run tests" }, { id: "2", text: "please run tests" },
    { id: "3", text: "please write text" }, { id: "4", text: "please write text" },
  ])
  const predictor = new WordPredictor([
    { word: "please", count: 100 },
    { word: "run", count: 100 },
    { word: "write", count: 100 },
    { word: "tests", count: 1 },
    { word: "text", count: 1 },
  ])
  predictor.setPersonal(model.snapshot())
  expect(complete(predictor, "please rnu")).toMatchObject({ suffix: "run", word: "run", replace: 3 })
  expect(complete(predictor, "please rnu ")?.suffix).toBe("tests")
  expect(complete(predictor, "please rnu te")?.suffix).toBe("sts")
  expect(complete(predictor, "please wirte ")?.suffix).toBe("text")
})
