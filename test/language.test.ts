import { expect, test } from "bun:test"
import { defaultLanguage, languageSetup } from "../src/language"
import { WordPredictor } from "../src/predictor"
import { completionQuery, spanishGrammar } from "../src/prose"

const predictorFor = (language: "es-419" | "en") => new WordPredictor(languageSetup[language].vocabulary, languageSetup[language].grammar)

test("Latin American Spanish is the default language", () => {
  expect(defaultLanguage).toBe("es-419")
})

test("Spanish completes accented prose words from the bundled vocabulary", () => {
  const predictor = predictorFor("es-419")
  const query = completionQuery("Quiero ver si funcio", 20, [], false, spanishGrammar)!
  expect(predictor.complete(query)).toMatchObject({ suffix: "na", word: "funciona" })
  expect(predictor.complete(completionQuery("Estoy muy conten", 16, [], false, spanishGrammar)!)).toMatchObject({ suffix: "to", word: "contento" })
})

test("Spanish opening punctuation starts a new word", () => {
  const predictor = predictorFor("es-419")
  const query = completionQuery("Hola, ¿cóm", 10, [], false, spanishGrammar)!
  expect(query.prefix).toBe("cóm")
  expect(predictor.complete(query)).toMatchObject({ suffix: "o", word: "cómo" })
})

test("Latin American forms outweigh Peninsular-only forms in the bundled vocabulary", () => {
  const counts = new Map(languageSetup["es-419"].vocabulary.map(({ word, count }) => [word, count]))
  expect(counts.get("carro")!).toBeGreaterThan(counts.get("coche")! * 0.3)
  expect(counts.get("ordenador")!).toBeLessThan(counts.get("computadora")!)
  expect(counts.get("vosotros")!).toBeLessThan(counts.get("ustedes")!)
})

test("English remains available with its own prior and grammar", () => {
  const predictor = predictorFor("en")
  const text = "I want to complete"
  const query = completionQuery(text, text.length, [], false, languageSetup.en.grammar)!
  expect(predictor.complete(query)).toBeDefined()
  expect(languageSetup.en.grammar.pronounI).toBe(true)
  expect(languageSetup["es-419"].grammar.pronounI).toBe(false)
})
