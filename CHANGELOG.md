# Changelog

All notable changes to Brainstormform are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-21

### Added

- **Bundled `brainstorming` skill.** A copy of the superpowers brainstorming
  skill (MIT, see `skills/brainstorming/NOTICE`) ships in the repo and is
  installed by `install-skill`/`setup` when no copy is present, so agents
  without superpowers can still elicit intent and requirements before building.
  It is advice, not an obligation: the trigger wording is softened to a
  recommendation, and the Brainstormform skill suggests pairing the two —
  brainstorming as the front end, Brainstormform as the question surface.
- **Opt-in compact and Markdown answers.** `wait`, `get`, `progress` and `export`
  accept `--format json` (a compact `{ answers: { id: value }, notes? }` map) or
  `--format md` (a Markdown summary). The MCP `read_answers` /
  `wait_for_answers` tools take the same `format`. The default `full` shape is
  unchanged.
- **`progress --since <revision>`.** The server records which question ids
  changed on every save; a poll can return only the delta (falling back to the
  full answers when more than one save was missed).
- **`matrix` and `rank` question types.** A matrix is a row × column grid, a rank
  lets the user reorder options.
- **Server-side adaptive follow-ups.** A question may declare
  `then: { question, … , add: [...] }`; the form appends the follow-ups when the
  condition first matches, with no agent polling.
- **`ask --from <id>`** seeds a new form's defaults with a past session's
  answers, **`ask --preset <name>`** loads a bundled question bank, and
  **`resume <id>`** restarts the server for a session whose process exited.
- **`--force`** lets `--out`/`export` overwrite a non-empty directory.
- **MCP `brainstormform://guide` resource**, so tool descriptions can stay short.
- **Front-end extras:** an optional scale slider (`settings.scaleStyle`),
  auto-advance (`settings.autoAdvance`), a `?` keyboard-shortcut overlay, a print
  stylesheet, a section label and a "Skip section" button.
- **Notes on every question.** Any question — including one you answered or
  skipped — accepts a free-text note, returned in a `notes` map keyed by
  question id. It is the place to add nuance when no option is quite right. The
  skill, `guide` and docs tell agents to prompt for and read notes.
- `settings.theme` and `settings.submitLabel` are now honoured by the form: the
  spec can set the initial theme (your toggle still wins) and the Next button
  label.
- The review screen's action bar is now the sticky footer, so **Confirm & send**
  is always reachable without scrolling.
- README badges, an animated demo GIF and a social preview card.
- `PROMOTION.md`: launch checklist and ready-to-post copy for Show HN, X,
  Reddit, Product Hunt, directories and a blog outline.

### Changed

- **MCP results are a single compact JSON text payload** (no pretty-print and no
  duplicate `structuredContent`), and `read_answers` accepts `since`.
- `waitForAnswers` resolves on filesystem changes instead of a 300 ms poll.
- `wait --timeout 0` / `wait_for_answers({ timeoutSeconds: 0 })` now return
  immediately instead of blocking.
- Local `visual` images must live under the directory `ask` runs from.
- The npm package now ships `docs/`, `presets/`, `CHANGELOG.md` and
  `CONTRIBUTING.md`.
- `VERSION` is read from `package.json`; CI runs `node --check` over `src/`.
- `question.default` is now actually applied by the form (it was normalised but
  ignored), which also backs `ask --from`.
- The front-end script moved to `src/ui.js`, so the form's CSP no longer needs
  `script-src 'unsafe-inline'`.

### Fixed

- A question's **note is always free text.** Editing the note on a number (or
  any) question no longer fell through to the answer handler and overwrote the
  answer — for a number question it coerced the note with `Number()`.
- `--out` / `export --to` no longer recursively delete a non-empty destination
  that is not a session directory; pass `--force` to override.
- Oversized request bodies stop being read as soon as the limit is crossed.
- CLI flags no longer swallow the next argument: `ask --open questions.json`
  works. A shared parser replaces the two copies.
- `scale`/`number` reject a non-positive `step`, which could freeze the form in
  an infinite loop; `maxFiles` is clamped to at least one.
- Un-skipping a question no longer re-marks it skipped after a reload.
- Required-question errors stay visible when `Finish` jumps to another page.
- Session ids are validated before use, so `stop <path>` cannot delete outside
  the session root.
- `SIGINT` now shuts the session server down cleanly.

## [0.3.0] - 2026-09-21

### Added

- **`brainstormform setup`** — an interactive wizard that detects installed
  agents (Claude Code, Codex, opencode, Cursor, Gemini CLI), installs the skill,
  writes the MCP entry with a backup of each config file, and runs `doctor`.
  `--yes` and `--target` make it scriptable.
- **`brainstormform doctor`** — checks Node, the CLI on PATH, writable data
  directories, agent configs, browser opener and a live MCP handshake, and lists
  every path the tool can touch. `--json` for machines.
- **`brainstormform update [--check]`** — npm-based self-update.
- **`--json`** output for the text commands (`help`, `guide`, `version`) and a
  JSON error shape in JSON mode.
- **`install.sh`** — a `curl | sh` installer that checks Node and installs the
  CLI globally.
- **Release automation** — a `Release` workflow that packs, checksums and
  publishes a GitHub Release on a tag, and a `Publish` workflow that pushes to
  npm when an `NPM_TOKEN` secret is present.
- **`AGENTS.md`** and **`docs/install.md`** (install, per-agent wiring, what
  touches disk, troubleshooting), plus richer MCP tool descriptions.

### Fixed

- The browser form no longer scrolls to the top when an answer is clicked.
- Progress saves can no longer be dropped when a save is already in flight.

## [0.2.0] - 2026-09-21

### Added

- **Live sessions.** Answers save to the local server as the user types. An agent
  can read progress and append follow-up questions while the user is still
  answering; the session is only reported as done when the user presses Finish.
- **MCP tools:** `read_answers`, `add_questions`, `wait_for_answers`, plus
  `resources` notifications when answers change or the session is submitted.
- **Conditional questions** via `showIf` (`equals`, `not`, `in`, `contains`,
  `answered`).
- **Visual question type** with image options from an `https://` URL or a local
  file (served through a whitelisted route).
- **Rich content:** per-category heading and intro, per-question `intro` and
  `content`, Markdown in labels and text, links opening in a new tab.
- **Compact review screen** before sending, with skipped, unanswered and hidden
  questions distinguished in the output.
- **Keyboard shortcuts:** `1`–`9` to pick an option, `Enter` to advance.
- **CLI:** `progress`, `add`, `export`, `archive list`, `install-skill`, and the
  `--out`, `--commit`, `--archive` and `--on-submit` flags.
- **Bundled agent skill** that helps an agent choose between Brainstormform and
  its built-in question tool.
- **Documentation:** rewritten README and a `docs/` folder (schema, CLI, MCP,
  live sessions).

### Changed

- A category `title` is now required when using `categories` (it used to default
  to `Section N`).
- `GET /api/questions` now returns `{ spec, revision, status }` instead of the
  raw spec.
- The Next button label defaults to `Continue`; a persistent `Finish` button is
  always available.

## [0.1.0] - 2026-09-21

### Added

- Initial release: local form server, CLI (`ask`/`wait`/`get`/`list`/`stop`/
  `cleanup`/`schema`/`guide`), MCP server (`ask_questions`, `get_answers`), and a
  dependency-free paginated UI.
