# Contributing to Brainstormform

Thanks for wanting to help. Brainstormform is meant to be a small, sharp tool, so
the bar for new code is "does this earn its place?"

## Getting started

```bash
git clone https://github.com/dutchbase/Brainstormform.git
cd brainstormform
npm test                                   # no dependencies to install
node bin/brainstormform ask examples/roadmap.json
```

There is no build step and no runtime dependencies. Please keep it that way
unless there is a very good reason.

## How it fits together

| File | Responsibility |
| --- | --- |
| `src/cli.mjs` | Commands, argument parsing, session lifecycle |
| `src/server.mjs` | The short-lived localhost server: progress, SSE, append, submit, uploads |
| `src/session.mjs` | Session directories, waiting, export/archive/commit |
| `src/schema.mjs` | Question spec validation, append fragments, the docs agents read |
| `src/render.mjs` | Pure helpers shared by the browser and tests: Markdown, `showIf` |
| `src/mcp.mjs` | MCP stdio server and notifications |
| `src/ui.html` | The whole front end, one self-contained file that imports `render.mjs` |
| `skills/brainstormform/SKILL.md` | Agent guidance on when to use this tool |
| `docs/` | Question format, CLI, MCP and live-session docs |

The browser loads `src/render.mjs` from the server as an ES module, so the same
pure functions are unit-tested in Node without a build step. Keep them free of
DOM and Node APIs.

## Adding a question type

Question types are the most common contribution. To add one:

1. Add the name to `QUESTION_TYPES` in `src/schema.mjs` and normalize its fields
   in `normalizeQuestion`.
2. Add validation in `validateQuestion` in `src/ui.html`.
3. Add a render branch in `questionHtml` in `src/ui.html`.
4. Add a case to `buildOutput` and to the review summary in `src/ui.html`.
5. Add a test in `test/smoke.test.mjs` (and `test/render.test.mjs` if it adds
   pure logic).

If the type needs a new endpoint, add it to the router in `src/server.mjs` and
keep it token- and host-guarded.

## Tests

`npm test` runs the Node test runner. Keep the suite fast and dependency-free.
For non-trivial logic, leave at least one check that fails if the logic breaks.
There is an optional browser smoke test recipe in the Git history: run a session
with `?nostream=1` and load it with `chromium --headless --dump-dom`.

## Pull requests

- Keep the change focused; one thing per PR.
- Run `npm test` before opening a PR.
- Match the existing style: no frameworks, no build step, plain modern JS.
- Update `docs/` when behaviour or the spec changes, and add a `CHANGELOG.md`
  entry under `Unreleased`.
- Say what you changed and why in the description. Screenshots for UI changes are
  very welcome.

## Ideas that are up for grabs

See the roadmap in the [README](README.md#roadmap). Ranking and matrix
questions, a searchable archive, and a standalone binary are all wanted.
