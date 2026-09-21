# Changelog

All notable changes to Brainstormform are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- README badges, an animated demo GIF and a social preview card.
- `PROMOTION.md`: launch checklist and ready-to-post copy for Show HN, X,
  Reddit, Product Hunt, directories and a blog outline.

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
