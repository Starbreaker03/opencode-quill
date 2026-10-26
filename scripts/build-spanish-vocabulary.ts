import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const SOURCE = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt"
const OUTPUT = fileURLToPath(new URL("../src/spanish-vocabulary.ts", import.meta.url))
const LIMIT = 20_000

const PENINSULAR = ["vosotros", "vosotras", "habéis", "sois", "ordenador", "tío", "tía", "guay", "mola", "flipar", "ostras"]
const LATAM = ["carro", "computadora", "celular", "platicar", "manejar", "jugo", "boleto", "durazno", "plata"]

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`cannot fetch ${SOURCE}: ${response.status}`)

const counts = new Map<string, number>()
for (const line of (await response.text()).split("\n")) {
  const [raw, value] = line.trim().split(/\s+/)
  const count = Number(value)
  if (!raw || !/^\p{L}+$/u.test(raw) || !Number.isFinite(count) || count <= 0) continue
  const word = raw.normalize("NFC").toLowerCase()
  counts.set(word, (counts.get(word) ?? 0) + count)
}

for (const word of PENINSULAR) {
  const key = word.normalize("NFC")
  if (counts.has(key)) counts.set(key, Math.round(counts.get(key)! * 0.2))
}
for (const word of LATAM) {
  const key = word.normalize("NFC")
  if (counts.has(key)) counts.set(key, counts.get(key)! * 3)
}

const rows = [...counts]
  .sort((a, b) => b[1] - a[1])
  .slice(0, LIMIT)
  .map(([word, count]) => `  [${JSON.stringify(word)}, ${count}],`)
  .join("\n")

await writeFile(OUTPUT, [
  "export const spanishVocabulary: ReadonlyArray<readonly [string, number]> = [",
  rows,
  "]",
  "",
].join("\n"))
console.log(`wrote ${Math.min(counts.size, LIMIT)} words to ${OUTPUT}`)
