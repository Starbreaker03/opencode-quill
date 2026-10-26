import subtlex from "subtlex-word-frequencies"
import type { Frequency } from "./predictor"
import { proseGrammar, spanishGrammar, type Grammar } from "./prose"
import { spanishVocabulary } from "./spanish-vocabulary"

export const languages = ["es-419", "en"] as const
export type Language = (typeof languages)[number]
export const defaultLanguage: Language = "es-419"

export const languageSetup: Record<Language, { grammar: Grammar; vocabulary: readonly Frequency[] }> = {
  "es-419": {
    grammar: spanishGrammar,
    vocabulary: spanishVocabulary.map(([word, count]) => ({ word, count })),
  },
  en: { grammar: proseGrammar, vocabulary: subtlex },
}
