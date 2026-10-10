# AGENTS.md — quill

## What this is

An OpenCode V2 TUI plugin for local word autocomplete and next-word prediction.
README.md is the user-facing contract — read it before changing behavior.

## Layout

- `src/tui.tsx` — V2 plugin entrypoint, lifecycle hooks, keymaps, storage, and session listeners.
- `src/prose.ts` — prose masking, tokenization, context extraction, and query detection.
- `src/predictor.ts` — n-gram language model, SUBTLEX prior blending, learning, and candidate ranking.
- `src/ghost.ts` — OpenTUI buffer painting, cursor tracking, eligibility checks, and insertion.
- `src/options.ts` — option parsing and validation.
- `src/keymap.ts` — reactive keymap layer construction for accept and dismiss actions.
- `test/` — Bun unit and installer tests.
- `install.sh` — copies sources and registers a directory in global `cli.json`.
- `scripts/changelog.sh`, `tests/changelog.sh` — shared release tooling.
- `.github/workflows/` — CI and npm trusted-publisher releases.

## Learning, Prediction, and Storage

- **Learning Pipeline:** Listens to session lifecycle events (`session.execution.started`,
  `session.execution.succeeded`, `session.inbox.delivered`). Messages are deduplicated
  by ID (capped at 8,000 IDs). Prose is masked against code, paths, URLs, shell
  commands, and pastes over 4,000 chars / 12 lines.
- **Model Growth:** Increments word frequencies, bigrams (`u\0w`), and trigrams
  (`u\0v\0w`). New words require at least two occurrences across distinct prompts.
  Prunes to top 8,000 words and 30,000 bigrams/trigrams on persistence.
- **Storage Location:** Durable JSON state managed via OpenCode's `context.storage.store()`
  under `~/.local/state/opencode/<channel>/tui/plugin.quill.learning.json` and
  `plugin.quill.settings.json`. Raw prompt text is never written to disk or stored.

## Commands

```sh
bun install
bun run test
bun run typecheck
bun run lint:sh
```

## Hard-won rules

- Target OpenCode V2 and use documented plugin APIs or public OpenTUI APIs.
- Keep prediction local; do not add model calls, hidden sessions, or telemetry.
- Register local TUI plugin directories in `cli.json`, not individual files.
- Suggestions must not enter the text buffer until explicitly accepted.
- Acceptance inserts text and never submits, overwrites a draft, or uses the clipboard.
- Capture keys only with a visible suggestion in the focused normal composer.
- Preserve host handlers, hints, selections, attachments, undo state, and other plugins.
- Ghost owns empty-composer next-prompt suggestions; Quill targets non-empty prose drafts.
- Ghost text dim level must match Ghost (`0.55` opacity over muted theme text).
- Remove listeners and render callbacks on unload; never write to destroyed editors.
- Keep learned prompt data out of Git and package tarballs.
- Keep installed sources identical to this repository when installing updates.

## Verifying

```sh
bun run test && bun run typecheck && bun run lint:sh
bash scripts/changelog.sh check
shellcheck -x --severity=error install.sh tests/*.sh scripts/*.sh
npm pack --dry-run
```

## Conventions

Follow Conventional Commits and the shared project standard. Copy shared
release tooling verbatim from Sesh or Ghost. Do not add code comments.
