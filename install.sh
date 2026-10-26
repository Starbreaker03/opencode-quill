#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/src"

if [ ! -f "$src/tui.tsx" ]; then
  echo "error: missing $src/tui.tsx" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required; no files were changed" >&2
  exit 1
fi

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [opencode-config-directory]" >&2
  exit 1
fi

target="${1:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required; no files were changed" >&2
  exit 1
fi

stage="$(mktemp -d "${TMPDIR:-/tmp}/quill-install.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp "$here/package.json" "$here/pnpm-lock.yaml" "$here/pnpm-workspace.yaml" "$stage/"
node - "$stage/package.json" <<'JS'
const fs = require("node:fs")
const [file] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
for (const name of ["solid-js", "@opencode/plugin"]) {
  manifest.dependencies = { ...manifest.dependencies, [name]: manifest.devDependencies[name] }
}
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
JS
if ! (cd "$stage" && pnpm install --lockfile-only --ignore-scripts >/dev/null && pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted >/dev/null); then
  echo "error: runtime dependency install failed; no files were changed" >&2
  exit 1
fi

node - "$src" "$target" "$stage/node_modules" <<'JS'
const fs = require("node:fs")
const path = require("node:path")
const { fileURLToPath } = require("node:url")
const [source, target, modules] = process.argv.slice(2)
const configDir = path.resolve(target)
const destination = path.join(configDir, "plugins", "opencode-quill")
const configFile = path.join(configDir, "cli.json")
const matches = (spec) => {
  if (typeof spec !== "string") return false
  if (/^opencode-quill(?:@[^/]+)?$/.test(spec)) return true
  try {
    const expanded = spec.startsWith("~/") ? path.join(require("node:os").homedir(), spec.slice(2)) : spec
    const resolved = expanded.startsWith("file://") ? fileURLToPath(expanded) : path.resolve(configDir, expanded)
    return resolved === destination || resolved === path.resolve(source)
  } catch {
    return false
  }
}
let config = {}
try {
  if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, "utf8"))
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error()
  if ("plugins" in config && !Array.isArray(config.plugins)) throw new Error()
} catch {
  console.error(`Cannot safely parse ${configFile} as a JSON object; no files were changed.`)
  process.exit(1)
}
const plugins = []
let position
let registration = {}
for (const item of config.plugins ?? []) {
  const spec = typeof item === "string" ? item : item?.package
  if (!matches(spec)) {
    plugins.push(item)
    continue
  }
  if (position === undefined) {
    position = plugins.length
    plugins.push(destination)
  }
  if (item && typeof item === "object") {
    const { package: ignored, ...fields } = item
    registration = { ...registration, ...fields }
  }
}
const entry = Object.keys(registration).length ? { ...registration, package: destination } : destination
if (position === undefined) plugins.push(entry)
else plugins[position] = entry
config.plugins = plugins
fs.mkdirSync(destination, { recursive: true })
for (const name of fs.readdirSync(source).filter((name) => /\.tsx?$/.test(name))) {
  fs.copyFileSync(path.join(source, name), path.join(destination, name))
}
fs.rmSync(path.join(destination, "tui.ts"), { force: true })
fs.copyFileSync(path.join(path.dirname(source), "tsconfig.json"), path.join(destination, "tsconfig.json"))
const vendored = path.join(destination, "node_modules")
fs.rmSync(vendored, { recursive: true, force: true })
fs.cpSync(modules, vendored, { recursive: true, filter: (from) => path.basename(from) !== ".bin" })
const temporary = path.join(configDir, `.cli.json-${require("node:crypto").randomUUID()}`)
try {
  const mode = fs.existsSync(configFile) ? fs.statSync(configFile).mode & 0o777 : 0o600
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode })
  fs.chmodSync(temporary, mode)
  fs.renameSync(temporary, configFile)
} finally {
  fs.rmSync(temporary, { force: true })
}
console.log(`installed -> ${destination}`)
console.log(`registered in ${configFile}`)
JS

echo "Restart OpenCode to load it."
