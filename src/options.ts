import { defaultLanguage, languages, type Language } from "./language"

export type Options = { enabled: boolean; completeAtLineEnd: boolean; completeShell: boolean; language: Language; acceptKeys: string[]; dismissKeys: string[]; cycleNextKeys: string[]; cyclePreviousKeys: string[] }

function keys(value: unknown, fallback: string[], name: string): string[] {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || !key.trim())) {
    throw new Error(`Quill ${name} must be an array of non-empty keybindings`)
  }
  return [...new Set(value.map((key: string) => key.trim()))]
}

function language(value: unknown): Language {
  if (value === undefined) return defaultLanguage
  if (!languages.some((supported) => supported === value)) throw new Error(`Quill language must be one of: ${languages.join(", ")}`)
  return value as Language
}

export function resolveOptions(input: Readonly<Record<string, unknown>>): Options {
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Quill enabled must be a boolean")
  if (input.completeAtLineEnd !== undefined && typeof input.completeAtLineEnd !== "boolean") throw new Error("Quill completeAtLineEnd must be a boolean")
  if (input.completeShell !== undefined && typeof input.completeShell !== "boolean") throw new Error("Quill completeShell must be a boolean")
  return {
    enabled: input.enabled !== false,
    completeAtLineEnd: input.completeAtLineEnd === true,
    completeShell: input.completeShell !== false,
    language: language(input.language),
    acceptKeys: keys(input.acceptKeys, ["tab", "right"], "acceptKeys"),
    dismissKeys: keys(input.dismissKeys, ["escape"], "dismissKeys"),
    cycleNextKeys: keys(input.cycleNextKeys, [], "cycleNextKeys"),
    cyclePreviousKeys: keys(input.cyclePreviousKeys, [], "cyclePreviousKeys"),
  }
}

export type QuillCommand =
  | { type: "toggle" }
  | { type: "enable"; value: boolean }
  | { type: "clear" }
  | { type: "shell"; value: boolean }
  | { type: "casing" }
  | { type: "invalid" }

export function parseQuillCommand(input: string | undefined): QuillCommand {
  const raw = input?.trim().toLowerCase() ?? ""
  if (!raw || raw === "toggle") return { type: "toggle" }
  if (raw === "clear" || raw === "reset") return { type: "clear" }
  if (raw === "clear casing" || raw === "reset casing") return { type: "casing" }
  if (raw === "on") return { type: "enable", value: true }
  if (raw === "off") return { type: "enable", value: false }
  if (raw === "shell on") return { type: "shell", value: true }
  if (raw === "shell off") return { type: "shell", value: false }
  return { type: "invalid" }
}
