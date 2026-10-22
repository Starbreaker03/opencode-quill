import { expect, test } from "bun:test"
import { completionQuery, leftContext, maskProse, proseSequences, proseWords } from "../src/prose"
import { PersonalModel } from "../src/predictor"

test.each(["```text\ncode\n```not-a-close\nplease complete", "~~~text\ncode\n```\nplease complete", "````text\ncode\n```\nplease complete", "\tplease complete"])("keeps fenced and tab-indented prose out of learning and completion: %s", (text) => {
  const model = new PersonalModel()
  model.observe([{ id: "repro", text }])
  expect(model.snapshot().words).toEqual([])
  expect(completionQuery(text, text.length)).toBeUndefined()
  expect(completionQuery(text + "\nlater", text.length, [], true)).toBeUndefined()
  expect(maskProse(text).length).toBe(text.length)
})

test.each(["```text\ncode\n```` \t\nplease comp", "~~~text\ncode\n~~~~\nplease comp", "```same line```\nplease comp", "```text\n😊 hidden\n```\nplease comp"])("recognizes closing fences without shifting prose: %s", (text) => {
  expect(completionQuery(text, text.length)?.prefix).toBe("comp")
  expect(maskProse(text).length).toBe(text.length)
})

test("queries the word suffix and next word at the end of a draft", () => {
  const words = [{ text: "can", start: 0, end: 3 }, { text: "you", start: 4, end: 7 }]
  expect(completionQuery("can you refac", 13)).toEqual({ before: "can you ", prefix: "refac", next: false, words })
  expect(completionQuery("can you ", 8)).toEqual({ before: "can you ", prefix: "", next: true, words })
  expect(completionQuery("refac later", 5)).toBeUndefined()
  expect(completionQuery("", 0)).toBeUndefined()
  expect(completionQuery("    ", 4)).toBeUndefined()
  expect(completionQuery("done. ", 6)).toBeUndefined()
})

test("logical line ends are opt-in, cursor-local, and never arbitrary mid-line positions", () => {
  const text = "please comp\nlater prose"
  expect(completionQuery(text, 11)).toBeUndefined()
  expect(completionQuery(text, 11, [], true)).toMatchObject({ before: "please ", prefix: "comp", next: false })
  for (const offset of [-1, 0, 10, 12, text.length + 1]) {
    expect(completionQuery(text, offset, [], true)).toBeUndefined()
  }
  expect(completionQuery("please comp\n\nlater", 12, [], true)).toBeUndefined()
  expect(completionQuery("please \nlater", 7, [], true)).toMatchObject({ prefix: "", next: true })
  expect(completionQuery("please comp\r\nlater", 11, [], true)).toBeUndefined()
  expect(completionQuery("please comp", 11, [], true)).toEqual(completionQuery("please comp", 11))
})

test("line-end queries mask the full draft before slicing around code and protected ranges", () => {
  for (const text of ["```text\nplease comp\n```\nlater", "~~~\nplease comp\n~~~\nlater", "please `comp\nlater`"]) {
    const offset = text.indexOf("comp") + 4
    expect(completionQuery(text, offset, [], true)).toBeUndefined()
  }
  const text = "```\nhidden\n```\n😊 漢字 e\u0301 comp\n```\nhidden later\n```"
  const offset = text.indexOf("comp") + 4
  expect(completionQuery(text, offset, [], true)?.prefix).toBe("comp")
  expect(completionQuery(text, offset, [[offset - 4, offset]], true)).toBeUndefined()
  expect(completionQuery(text, offset, [[offset + 1, text.length]], true)?.prefix).toBe("comp")
  const afterChip = "[Image 1] comp\nlater"
  expect(completionQuery(afterChip, 14, [[0, 9]], true)?.prefix).toBe("comp")
  expect(completionQuery("[Image 1] \nlater", 10, [[0, 9]], true)).toBeUndefined()
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
  "/quill", "!echo hello", "$ git status", "edit src/sub/compo", "edit foo.xyz", "edit .conf",
  "use foo_bar", "use camelCase", "ping @alice", "https://example.com/hel", "let variable",
  "please `complete this", "please `complete this`", "```ts\ncomplete this", "~~~\ncomplete this",
  "    complete this", "key=secret", "--option", "use -x", "use a--b", "use a-1", "use --frozen-lock", "port 8080", "[label](link)",
])("does not complete non-prose: %s", (text) => {
  expect(completionQuery(text, text.length)).toBeUndefined()
})

test("masks leading slash commands while completing and learning trailing prose", () => {
  expect(completionQuery("/btw", 4)).toBeUndefined()
  expect(completionQuery("/btw ", 5)).toBeUndefined()
  expect(completionQuery("/btw can you comp", 17)).toEqual({
    before: "/btw can you ",
    prefix: "comp",
    next: false,
    words: [
      { text: "can", start: 5, end: 8 },
      { text: "you", start: 9, end: 12 },
    ],
  })
  expect(completionQuery("/btw can you ", 13)).toEqual({
    before: "/btw can you ",
    prefix: "",
    next: true,
    words: [
      { text: "can", start: 5, end: 8 },
      { text: "you", start: 9, end: 12 },
    ],
  })
  expect(proseSequences("/btw please run tests").map((sequence) => sequence.map((word) => word.text)))
    .toEqual([["please", "run", "tests"]])
})

test("queries slash-joined tokens and trailing-slash prefixes without admitting paths", () => {
  expect(completionQuery("machine/", 8)).toEqual({ before: "", prefix: "machine/", next: false, words: [] })
  expect(completionQuery("rebase machine/", 15)).toEqual({
    before: "rebase ",
    prefix: "machine/",
    next: false,
    words: [{ text: "rebase", start: 0, end: 6 }],
  })
  expect(completionQuery("rebase machine/w", 16)).toEqual({
    before: "rebase ",
    prefix: "machine/w",
    next: false,
    words: [{ text: "rebase", start: 0, end: 6 }],
  })
  expect(proseSequences("rebase machine/work onto clean dist/ folder").map((sequence) => sequence.map((word) => word.text)))
    .toEqual([["rebase", "machine/work", "onto", "clean"], ["folder"]])
  expect(proseSequences("push to origin/main. skip dist/. now").map((sequence) => sequence.map((word) => word.text)))
    .toEqual([["push", "to", "origin/main"], ["skip"], ["now"]])
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

test("large synthetic drafts retain bounded context and reject drafts beyond the existing limit", () => {
  const text = "word ".repeat(3199) + " comp"
  expect(text.length).toBe(16_000)
  const query = completionQuery(text, text.length)!
  expect(query.prefix).toBe("comp")
  expect(query.before).toHaveLength(2000)
  expect(query.words!.length).toBeLessThanOrEqual(400)
  expect(completionQuery(text + " ", text.length + 1)).toBeUndefined()
  const code = "```\n" + "hidden ".repeat(1000)
  expect(completionQuery(code, code.length)).toBeUndefined()
})

const learned = (text: string, times = 2) => {
  const model = new PersonalModel()
  model.observe(Array.from({ length: times }, (_, index) => ({ id: String(index), text })))
  return Object.fromEntries(model.snapshot().words)
}

test("hyphenated words are single words, prefixes may end in a hyphen, and flags stay masked", () => {
  expect(proseWords("a read-only doc-drift check").map((word) => word.text)).toEqual(["a", "read-only", "doc-drift", "check"])
  expect(completionQuery("fix doc-", 8)).toMatchObject({ before: "fix ", prefix: "doc-", next: false })
  expect(completionQuery("fix doc-dr", 10)).toMatchObject({ prefix: "doc-dr" })
  expect(completionQuery("fix doc- ", 9)).toBeUndefined()
  expect(learned("see doc-drift now")).toMatchObject({ "doc-drift": 2 })
  expect(learned("pre- and post-fix --force -x a - b")).not.toHaveProperty("pre")
  expect(learned("run --frozen-lockfile now")).not.toHaveProperty("frozen")
  expect(Object.keys(learned("well-known - not-quite-ready --dry-run")).sort()).toEqual(["not-quite-ready", "well-known"])
})

test("hyphenated words keep their neighbours as context", () => {
  expect(leftContext("make it read-only ")).toEqual(["it", "read-only"])
})

test.each([
  ["OpenCode", true], ["GitHub", true], ["OpenTUI", true], ["CloudLinux", true], ["cPanel", true], ["macOS", true], ["iPhone", true],
  ["showSidebar", false], ["onClose", false], ["sessionID", false], ["registerLayer", false], ["TuiPluginApi", false], ["devDeps", false],
])("mixed-case token %s is prose: %s", (token, prose) => {
  expect(proseWords(`use ${token} here`).map((word) => word.text)).toEqual(prose ? ["use", token.toLowerCase(), "here"] : ["use", "here"])
  expect(proseWords(`${token}'s`).length > 0).toBe(prose)
})

test("brand names learn their casing", () => {
  const model = new PersonalModel()
  model.observe([{ id: "a", text: "I like OpenCode and GitHub" }, { id: "b", text: "we use OpenCode and GitHub" }])
  expect(model.snapshot().forms).toEqual(expect.arrayContaining([["OpenCode", 2], ["GitHub", 2]]))
})

test("bare filenames with known extensions are words, other dotted tokens and paths are not", () => {
  expect(proseWords("edit install.sh and AGENTS.md then Node.js").map((word) => word.text)).toEqual(["edit", "install.sh", "and", "agents.md", "then", "node.js"])
  expect(proseWords("edit scripts/changelog.sh, foo.xyz, e.g. v1.ts and a.b.c").map((word) => word.text)).toEqual(["edit", "and"])
  expect(proseWords("open package.json.").map((word) => word.text)).toEqual(["open", "package.json"])
  expect(completionQuery("edit pack", 9)).toMatchObject({ prefix: "pack" })
  expect(completionQuery("edit package.js", 15)).toMatchObject({ prefix: "package.js" })
  expect(completionQuery("edit src/install.sh", 19)).toBeUndefined()
})

test("indented lines continue list items but stay masked elsewhere", () => {
  expect(proseWords("- first item\n    continues here").map((word) => word.text)).toEqual(["first", "item", "continues", "here"])
  expect(proseWords("1. first\n\n    second paragraph\n        deeper").map((word) => word.text)).toEqual(["first", "second", "paragraph", "deeper"])
  expect(proseWords("plain text\n    indented code").map((word) => word.text)).toEqual(["plain", "text"])
  expect(proseWords("- item\ninterrupt\n    indented code").map((word) => word.text)).toEqual(["item", "interrupt"])
  expect(completionQuery("- item\n    contin", 17)).toMatchObject({ prefix: "contin" })
})
