import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
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
  chmodSync(join(directory, "cli.json"), 0o600)
  expect(install(directory).status).toBe(0)
  expect(statSync(join(directory, "cli.json")).mode & 0o777).toBe(0o600)
  const config = JSON.parse(readFileSync(join(directory, "cli.json"), "utf8"))
  expect(config.theme).toEqual({ name: "tokyonight" })
  expect(config.plugins).toEqual([ghost, {
    package: join(directory, "plugins/opencode-quill"), options: { enabled: false },
  }])
})

test.each(["write", "rename"])("failed config %s keeps the original file intact and cleans temporary files", (phase) => {
  const directory = target()
  mkdirSync(directory, { recursive: true })
  const file = join(directory, "cli.json")
  const original = '{"plugins":["opencode-ghost"],"theme":{"name":"test"}}\n'
  writeFileSync(file, original)
  const preload = join(roots.at(-1)!, "fail.cjs")
  writeFileSync(preload, `
const fs = require("node:fs")
const write = fs.writeFileSync
const rename = fs.renameSync
fs.writeFileSync = function(file, ...args) {
  if (${JSON.stringify(phase)} === "write" && String(file).includes("cli.json")) {
    write.call(this, file, "partial")
    throw new Error("injected write failure")
  }
  return write.call(this, file, ...args)
}
fs.renameSync = function(from, to) {
  if (${JSON.stringify(phase)} === "rename" && String(to).endsWith("cli.json")) throw new Error("injected rename failure")
  return rename.call(this, from, to)
}
`)
  const result = spawnSync("bash", [installer, directory], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--require=${preload}` } })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(`injected ${phase} failure`)
  expect(readFileSync(file, "utf8")).toBe(original)
  expect(readdirSync(directory).sort()).toEqual(["cli.json", "plugins"])
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
