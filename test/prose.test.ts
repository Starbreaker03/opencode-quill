import { expect, test } from "bun:test"
import { completionQuery, leftContext, maskProse, proseSequences } from "../src/prose"

test("queries the word suffix and next word at the end of a draft", () => {
  expect(completionQuery("can you refac", 13)).toEqual({ before: "can you ", prefix: "refac", next: false })
  expect(completionQuery("can you ", 8)).toEqual({ before: "can you ", prefix: "", next: true })
  expect(completionQuery("refac later", 5)).toBeUndefined()
  expect(completionQuery("", 0)).toBeUndefined()
  expect(completionQuery("    ", 4)).toBeUndefined()
  expect(completionQuery("done. ", 6)).toBeUndefined()
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
  expect(proseSequences("please run tests. please `code` fix bugs"))
    .toEqual([["please", "run", "tests"], ["please"], ["fix", "bugs"]])
})

test("supports accented, combining, and non-Latin words after other Unicode text", () => {
  for (const text of ["😊 café ré", "漢字 請修", "please re\u0301", "please don’t"]) {
    expect(completionQuery(text, text.length)?.prefix).toBe(text.split(" ").at(-1))
  }
})
