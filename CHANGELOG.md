# Changelog

All notable changes are documented in this file using
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-13

### Added

- **prediction:** Add safe typo correction and context repair

## [0.1.5] - 2026-10-10

### Fixed

- **tui:** Skip history-learning warning for opportunistic syncs

## [0.1.4] - 2026-10-10

### Fixed

- **tui:** Depend on opentui 0.5.x so npm cannot resolve 0.6.0

## [0.1.3] - 2026-10-10

### Fixed

- **tui:** Pin opentui peer dependencies to ^0.5.17 for arborist compatibility

## [0.1.2] - 2026-10-10

### Fixed

- Align peer dependencies with opencode to resolve npm ERESOLVE

## [0.1.1] - 2026-10-10

### Fixed

- **ci:** Handle root commit in commitlint range
- Add `@jsxImportSource @opentui/solid` pragma to the TUI entrypoint so npm cache compilation doesn't fall back to React.
- Constrain `@opentui/core` and `@opentui/solid` peer dependencies to `<0.6.0` with `peerDependenciesMeta` set to optional, preventing conflicting nested OpenTUI versions.
- Support `/quill clear` and `/quill reset` to wipe learned vocabulary and n-gram state.

## [0.1.0] - 2026-10-10

### Added

- Local word autocomplete and next-word prediction plugin for OpenCode V2.
- High-frequency English vocabulary prior derived from SUBTLEX word frequencies.
- Online absolute-discounting n-gram model learning from submitted session prompts.
- Inline ghost-text rendering at visual cursor with matching Ghost dim level (`0.55`).
- Safe acceptance (<kbd>Tab</kbd>, <kbd>→</kbd>) and dismissal (<kbd>Esc</kbd>) without draft submission.
- Prose-aware filtering suppressing suggestions in code, paths, URLs, and shell commands.
- `/quill` command and command palette action to toggle autocomplete.
- Local installer script, full test suite, CI workflows, and release tooling.

[0.2.0]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ozandogrultan/opencode-quill/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ozandogrultan/opencode-quill/releases/tag/v0.1.0
