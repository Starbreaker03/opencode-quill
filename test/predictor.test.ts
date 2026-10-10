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
