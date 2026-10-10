import { afterEach, expect, test } from "bun:test"
import { BoxRenderable, RGBA, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { ComposerGhost, dimGhostColor, eligibleComposer, type Composer } from "../src/ghost"
import { PersonalModel, WordPredictor } from "../src/predictor"

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

async function setup(text = "please comp", width = 60) {
  const testing = await createTestRenderer({ width, height: 8 })
  cleanups.push(() => testing.renderer.destroy())
  const parent = new BoxRenderable(testing.renderer, { id: "composer", width, height: 4, paddingLeft: 2, paddingTop: 1 })
  const editor = new TextareaRenderable(testing.renderer, { id: "input", width: "100%", height: 2, wrapMode: "word" })
  parent.add(editor)
  testing.renderer.root.add(parent)
  editor.setText(text)
  editor.gotoBufferEnd()
  editor.focus()
  const view: Composer = { editor, normal: true, focused: editor, mode: "base", selected: false, enabled: true }
  const predictor = new WordPredictor([{ word: "complete", count: 10 }, { word: "réviser", count: 10 }])
  const ghost = new ComposerGhost(editor, predictor, () => view, () => RGBA.fromHex("#888888"), testing.renderer)
  cleanups.push(() => ghost.dispose())
  await testing.renderOnce()
  return { ...testing, editor, ghost, view, predictor }
}

test("paints ghost text at the real cursor without changing the draft", async () => {
  const fixture = await setup()
  expect(fixture.captureCharFrame()).toContain("please complete")
  expect(fixture.editor.plainText).toBe("please comp")
  expect(fixture.ghost.visible()).toBe(true)
  expect(fixture.ghost.accept()).toBe(true)
  expect(fixture.editor.plainText).toBe("please complete")
})

test("uses Ghost's exact muted RGB and 0.55 alpha multiplier", () => {
  const muted = RGBA.fromValues(0.2, 0.4, 0.6, 0.8)
  const ghost = dimGhostColor(muted)
  expect(ghost.r).toBeCloseTo(muted.r)
  expect(ghost.g).toBeCloseTo(muted.g)
  expect(ghost.b).toBeCloseTo(muted.b)
  expect(ghost.a).toBeCloseTo(muted.a * 0.55)
})

test("Unicode insertion offsets work after emoji, wide characters, and combining marks", async () => {
  for (const text of ["😊 漢字 comp", "please re\u0301", "café comp"]) {
    const fixture = await setup(text)
    expect(fixture.ghost.visible()).toBe(true)
    expect(fixture.ghost.accept()).toBe(true)
    expect(fixture.editor.plainText).toBe(text.startsWith("please") ? "please re\u0301viser" : `${text}lete`)
  }
})

test("insertion preserves host content callbacks and never submits", async () => {
  const fixture = await setup()
  let changed = 0
  let submitted = 0
  const onContentChange = () => { changed++ }
  const onSubmit = () => { submitted++ }
  fixture.editor.onContentChange = onContentChange
  fixture.editor.onSubmit = onSubmit
  expect(fixture.ghost.accept()).toBe(true)
  await fixture.renderOnce()
  expect(changed).toBeGreaterThan(0)
  expect(submitted).toBe(0)
  expect(fixture.editor.onContentChange).toBe(onContentChange)
  expect(fixture.editor.onSubmit).toBe(onSubmit)
  expect(fixture.editor.undo()).toBe(true)
  expect(fixture.editor.plainText).toBe("please comp")
})

test("Escape hides an unchanged ghost and editing makes a new suggestion eligible", async () => {
  const fixture = await setup()
  expect(fixture.ghost.dismiss()).toBe(true)
  await fixture.renderOnce()
  expect(fixture.ghost.visible()).toBe(false)
  expect(fixture.captureCharFrame()).not.toContain("please complete")
  fixture.editor.insertText("l")
  await fixture.renderOnce()
  expect(fixture.ghost.visible()).toBe(true)
  expect(fixture.ghost.accept()).toBe(true)
  expect(fixture.editor.plainText).toBe("please complete")
})

test.each(["normal", "mode", "selected", "enabled", "focused"] as const)("falls through when composer eligibility changes: %s", async (field) => {
  const fixture = await setup()
  if (field === "mode") fixture.view.mode = "dialog"
  else if (field === "focused") fixture.view.focused = undefined
  else if (field === "selected") fixture.view.selected = true
  else fixture.view[field] = false
  expect(fixture.ghost.accept()).toBe(false)
  expect(fixture.editor.plainText).toBe("please comp")
  await fixture.renderOnce()
  expect(fixture.ghost.visible()).toBe(false)
})

test("does not override host autocomplete, extmarks, selections, or empty-composer hints", async () => {
  const fixture = await setup()
  fixture.editor.traits = { capture: ["tab", "navigate"] }
  expect(eligibleComposer(fixture.view)).toBe(false)
  expect(fixture.ghost.accept()).toBe(false)
  fixture.editor.traits = {}
  const mark = fixture.editor.extmarks.create({ start: 0, end: 2 })
  expect(fixture.ghost.accept()).toBe(false)
  fixture.editor.extmarks.delete(mark)
  fixture.editor.setSelection(0, 2)
  expect(fixture.ghost.accept()).toBe(false)
  fixture.editor.clearSelection()
  fixture.editor.setText("")
  fixture.editor.placeholder = "Ghost owns this hint"
  await fixture.renderOnce()
  expect(fixture.editor.placeholder).toBe("Ghost owns this hint")
  expect(fixture.ghost.visible()).toBe(false)
})

test("normal host Tab capture does not suppress word suggestions", async () => {
  const fixture = await setup()
  fixture.editor.traits = { capture: ["tab"], suspend: true }
  await fixture.renderOnce()
  expect(fixture.ghost.visible()).toBe(true)
  expect(fixture.ghost.accept()).toBe(true)
})

test("paints and inserts a context-ranked next word while preserving the trailing space", async () => {
  const fixture = await setup("please run ")
  const model = new PersonalModel()
  model.observe([{ id: "1", text: "please run tests" }, { id: "2", text: "please run tests" }])
  fixture.predictor.setPersonal(model.snapshot())
  fixture.ghost.invalidate()
  await fixture.renderOnce()
  expect(fixture.captureCharFrame()).toContain("please run tests")
  expect(fixture.editor.plainText).toBe("please run ")
  expect(fixture.ghost.accept()).toBe(true)
  expect(fixture.editor.plainText).toBe("please run tests")
})

test("stale text, moved cursors, and teardown never insert a suggestion", async () => {
  const fixture = await setup()
  fixture.editor.moveCursorLeft()
  expect(fixture.ghost.accept()).toBe(false)
  await fixture.renderOnce()
  expect(fixture.ghost.visible()).toBe(false)
  fixture.editor.gotoBufferEnd()
  await fixture.renderOnce()
  fixture.editor.insertText("x")
  expect(fixture.ghost.accept()).toBe(false)
  fixture.ghost.dispose()
  expect(fixture.ghost.accept()).toBe(false)
  fixture.editor.destroy()
  fixture.ghost.dispose()
})

test("clips ghost text within the editor viewport", async () => {
  const fixture = await setup("please comp", 16)
  const lines = fixture.captureCharFrame().split("\n")
  expect(lines[1]).toContain("please complet")
  expect(lines[1]).not.toContain("please complete")
  expect(fixture.editor.plainText).toBe("please comp")
})
