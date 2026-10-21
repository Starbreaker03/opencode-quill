import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import plugin from "../src/tui"

test("exports a V2 plugin definition", () => {
  expect(plugin.id).toBe("quill")
  expect(typeof plugin.setup).toBe("function")
})

test("the plugin validates logical-line-end options before registering resources", () => {
  const context = { options: { completeAtLineEnd: "yes" } } as unknown as Parameters<typeof plugin.setup>[0]
  expect(() => plugin.setup(context)).toThrow("Quill completeAtLineEnd must be a boolean")
})

test("package metadata points to the shipped plugin", () => {
  const root = resolve(import.meta.dir, "..")
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
  expect(manifest.name).toBe("opencode-quill")
  expect(existsSync(resolve(root, manifest.exports["./tui"]))).toBe(true)
  for (const name of ["src", "CHANGELOG.md", "LICENSE", "README.md"]) {
    expect(manifest.files).toContain(name)
  }
})
