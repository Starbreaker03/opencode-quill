import { expect, test } from "bun:test"
import { completionQuery, leftContext, maskProse, proseSequences, proseWords } from "../src/prose"

test("queries the word suffix and next word at the end of a draft", () => {
  const words = [{ text: "can", start: 0, end: 3 }, { text: "you", start: 4, end: 7 }]
  expect(completionQuery("can you refac", 13)).toEqual({ before: "can you ", prefix: "refac", next: false, words })
  expect(completionQuery("can you ", 8)).toEqual({ before: "can you ", prefix: "", next: true, words })
  expect(completionQuery("refac later", 5)).toBeUndefined()
  expect(completionQuery("", 0)).toBeUndefined()
  expect(completionQuery("    ", 4)).toBeUndefined()
  expect(completionQuery("done. ", 6)).toBeUndefined()
})

test("protected ranges are masked out of words and break left context", () => {
  const text = "fix Image [Image 1] comp"
  const query = completionQuery(text, text.length, [[10, 19]])!
  expect(query.prefix).toBe("comp")
  expect(query.words?.map((word) => word.text)).toEqual(["fix", "image"])
  expect(completionQuery("[Image 1] ", 10, [[0, 9]])).toBeUndefined()
  expect(completionQuery("[Image 1]", 9, [[0, 9]])).toBeUndefined()
  expect(completionQuery("see [Image", 10, [[4, 10]])).toBeUndefined()
  expect(completionQuery("please comp", 11, [[3, 3]])?.prefix).toBe("comp")
})

test.each([
  "/quill", "!echo hello", "$ git status", "edit src/compo", "edit foo.ts", "edit .conf",
  "use foo_bar", "use camelCase", "ping @alice", "https://example.com/hel", "let variable",
  "please `complete this", "please `complete this`", "```ts\ncomplete this", "~~~\ncomplete this",
  "    complete this", "key=secret", "--option", "use auth-token", "port 8080", "[label](link)",
])("does not complete non-prose: %s", (text) => {
  expect(completionQuery(text, text.length)).toBeUndefined()
})

test("code and punctuation break context without shifting Unicode offsets", () => {
  const text = "café 漢字 `code` please"
  expect(maskProse(text).length).toBe(text.length)
  expect(leftContext("please run ")).toEqual(["please", "run"])
  expect(leftContext("please. run ")).toEqual(["run"])
  expect(leftContext("please `code` run ")).toEqual(["run"])
  expect(proseSequences("please run tests. please `code` fix bugs").map((sequence) => sequence.map((word) => word.text)))
    .toEqual([["please", "run", "tests"], ["please"], ["fix", "bugs"]])
})

test("supports accented, combining, and non-Latin words after other Unicode text", () => {
  for (const text of ["😊 café ré", "漢字 請修", "please re\u0301", "please don’t"]) {
    expect(completionQuery(text, text.length)?.prefix).toBe(text.split(" ").at(-1))
  }
})

test("queries retain bounded, reusable prose tokens for context and local vocabulary", () => {
  const text = "earlier ".repeat(300) + "please run "
  const query = completionQuery(text, text.length)!
  expect(query.before.length).toBe(2000)
  expect(query.words).toEqual(proseWords(query.before))
  expect(leftContext(query.before, query.words)).toEqual(["please", "run"])
})

test("bounded query tokens retain masking established before the context window", () => {
  const text = "please `" + "hidden ".repeat(400) + "` run "
  const query = completionQuery(text, text.length)!
  expect(query.words?.map((word) => word.text)).toEqual(["run"])
  expect(leftContext(query.before, query.words)).toEqual(["run"])
})
