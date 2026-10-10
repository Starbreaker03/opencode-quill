import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const roots: string[] = []
const installer = resolve(import.meta.dir, "../install.sh")

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function target() {
  const root = mkdtempSync(join(tmpdir(), "opencode-quill-test-"))
  roots.push(root)
  return join(root, "config with spaces")
}

function install(directory: string) {
  return spawnSync("bash", [installer, directory], { encoding: "utf8" })
}

test("installs the entrypoint and registers a directory idempotently", () => {
  const directory = target()
  expect(install(directory).status).toBe(0)
  const configFile = join(directory, "cli.json")
  const original = readFileSync(configFile, "utf8")
  expect(JSON.parse(original).plugins).toEqual([join(directory, "plugins/opencode-quill")])
  expect(readFileSync(join(directory, "plugins/opencode-quill/tui.tsx"), "utf8"))
    .toBe(readFileSync(resolve(import.meta.dir, "../src/tui.tsx"), "utf8"))
  expect(existsSync(join(directory, "plugins/opencode-quill/node_modules/subtlex-word-frequencies/index.json"))).toBe(true)
  expect(readFileSync(join(directory, "plugins/opencode-quill/tsconfig.json"), "utf8"))
    .toBe(readFileSync(resolve(import.meta.dir, "../tsconfig.json"), "utf8"))
  expect(install(directory).status).toBe(0)
  expect(readFileSync(configFile, "utf8")).toBe(original)
})

test("preserves unrelated settings, Ghost, and Quill options", () => {
  const directory = target()
  mkdirSync(directory, { recursive: true })
  const ghost = { package: "opencode-ghost@1.3.7", options: { enabled: true } }
  writeFileSync(join(directory, "cli.json"), JSON.stringify({
    theme: { name: "tokyonight" },
    plugins: [ghost, { package: "opencode-quill@0.1.0", options: { enabled: false } }, "opencode-quill"],
  }))
  expect(install(directory).status).toBe(0)
  const config = JSON.parse(readFileSync(join(directory, "cli.json"), "utf8"))
  expect(config.theme).toEqual({ name: "tokyonight" })
  expect(config.plugins).toEqual([ghost, {
    package: join(directory, "plugins/opencode-quill"), options: { enabled: false },
  }])
})

test.each(["{", "[]", "null", '{"plugins": {}}'])("rejects invalid configuration without writing: %s", (raw) => {
  const directory = target()
  mkdirSync(directory, { recursive: true })
  const file = join(directory, "cli.json")
  writeFileSync(file, raw)
  const result = install(directory)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("no files were changed")
  expect(readFileSync(file, "utf8")).toBe(raw)
  expect(existsSync(join(directory, "plugins"))).toBe(false)
})
