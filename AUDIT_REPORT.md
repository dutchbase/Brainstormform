# Brainstormform — Code Audit

Audit date: 2026-09-21 · Version audited: 0.3.0 · Scope: whole repository

## Executive summary

Brainstormform is a dependency-free Node CLI, localhost form server and MCP
server. The architecture is clean, the security model is sound (loopback bind,
random token, `Host` guard, CSP, escaped output, atomic writes), and the test
suite is fast and meaningful. The issues found were a handful of real
correctness and validation bugs, two documented settings the form ignored, some
packaging and doc drift, and a few local-only hardening gaps. No critical
security hole was found. All findings below are fixed in `[Unreleased]`.

| Dimension | Score (1–10) |
| --- | --- |
| Architecture | 9 |
| Security | 7 |
| Code quality | 8 |
| Performance | 8 |
| UX / frontend | 7 |
| Maintainability | 8 |
| Tooling & DX | 7 |
| **Overall** | **7.7** |

## Findings

### 🟡 Major

**1. CLI arg parser swallowed positionals after boolean flags.**
`ask --open questions.json` parsed the filename as the value of `--open`, lost
the file and read stdin; `ask --keep q.json` also dropped `--keep`. Inline
values split on the first `=` truncated values that contained one.
*Fixed:* shared `src/args.mjs` only lets declared value flags consume the next
token, uses `indexOf('=')`, and handles `--`.

**2. `scale`/`number` accepted `step: 0`, freezing the form.**
`ui.html` loops `for (let v = q.min; v <= q.max; v += q.step)`; `step: 0`
produced an infinite loop and a hung tab.
*Fixed:* `normalizeQuestion` requires a finite `step > 0`.

**3. `settings.theme` and `settings.submitLabel` were normalised and documented
but never used.**
Setting `theme: "dark"` still followed the OS; `submitLabel` never replaced the
Next button.
*Fixed:* the form applies the spec theme on boot (an explicit toggle still
wins) and uses `submitLabel`.

**4. The npm package excluded its own docs.**
`package.json#files` omitted `docs/`, so README links to `docs/install.md` etc.
were broken for `npx` and npm users.
*Fixed:* `docs`, `CHANGELOG.md` and `CONTRIBUTING.md` are published.

### 🟠 Minor

**5. Un-skipped questions were re-marked skipped after reload.**
Toggling skip off set the value to `false` instead of removing the key;
`Object.keys()` persisted it and boot restored every listed id as skipped.

**6. `finish()` lost its validation errors across pages.**
`validateAll()` painted errors, then `goToQuestion()` re-rendered the DOM and
wiped them.

**7. Session id was used unsanitised in filesystem paths.**
`stop ../../foo` was a local path-traversal delete via `fsp.rm(dir, {recursive})`.

**8. `SIGINT` bypassed cleanup.** SIGTERM closed and removed the session dir;
Ctrl-C called `process.exit(0)` immediately.

**9. `timeout: 0` disagreed between CLI (wait forever) and MCP (return now).**

**10. `maxFiles` accepted zero and negatives**, producing an un-fillable file
question.

**11. Server-start failure was detected only after the 5s poll**, because the
daemon writes `pid` late.

**12. The asset route served any readable local file.** Local `visual` images
were resolved against cwd with no boundary.

**13. Upload count was client-enforced only.**

### 💡 Suggestions

- Two copies of `parseArgs` (CLI and server) → one shared module.
- `VERSION` duplicated in `schema.mjs` and `package.json`.
- Doc drift: top-level `title` documented required but defaulted; `number`
  `step` documented required but defaulted.
- Repo name casing inconsistent between `package.json` and the rest.
- No syntax gate in CI.
- A throw inside the MCP message chain could break the chain for later messages.
- The `--on-submit` hook can race session cleanup since it reads the answers
  file after the session may be deleted.

## Prioritised action plan

1. Fix the parser, `step`, and skip-persistence bugs (correctness).
2. Wire up `theme`/`submitLabel`, or delete them (make docs true).
3. Validate session ids, clean up on SIGINT, bound the asset route and uploads.
4. Publish the docs; reconcile doc defaults; single-source `VERSION`.
5. Add regression tests for every fix.

## What was done

All of the above landed under `[Unreleased]`:

- New `src/args.mjs` with tests; CLI and server use it.
- `scale`/`number` step validation; `maxFiles` clamp.
- Notes on every question (see below), theme/submitLabel wiring.
- Sticky review action bar so **Confirm & send** is always reachable.
- Session-id validation, SIGINT cleanup, asset confinement, upload cap.
- MCP message chain hardened against per-message throws.
- `docs`, changelog and contributing files published; `VERSION` read from
  `package.json`; `node --check` added to CI.
- Regression tests in `test/args.test.mjs` and `test/smoke.test.mjs`; suite
  grew from 17 to 26 tests.

### Notes feature (requested)

Any question carries an optional free-text note, including answered and skipped
ones, returned as a top-level `notes` map keyed by question id. It is the
escape hatch for "no single option is the true answer". Verified end-to-end in a
headless browser: note captured in the review screen and in `answers.json`. A
note attached to a `showIf`-hidden question is dropped client-side.

### Known residual

- The `--on-submit` hook still reads `answers.json` from disk after submit, so a
  very fast `wait` + cleanup can race it. Passing the answers inline would remove
  the race; deferred as out of scope.
- Hiding the action bar on the review screen is verified by hand in a headless
  browser rather than by an automated DOM test; the suite has no DOM harness by
  design.
