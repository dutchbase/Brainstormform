# Contributing to Brainstormform

Thanks for wanting to help. Brainstormform is meant to be a small, sharp tool,
so the bar for new code is "does this earn its place?"

## Getting started

```bash
git clone https://github.com/dutchbase/brainstormform.git
cd brainstormform
npm test                                   # no dependencies to install
node bin/brainstormform ask examples/roadmap.json
```

There is no build step and there are no runtime dependencies. Please keep it
that way unless there is a very good reason.

## How it fits together

| File | Responsibility |
| --- | --- |
| `src/cli.mjs` | Subcommands and argument parsing |
| `src/server.mjs` | The short-lived localhost HTTP server |
| `src/session.mjs` | Session directories, waiting, keep/cleanup |
| `src/schema.mjs` | Question spec validation + the docs the agent reads |
| `src/mcp.mjs` | MCP stdio server (`ask_questions`, `get_answers`) |
| `src/ui.html` | The whole front end, one self-contained file |

## Adding a question type

Question types are the most common contribution. To add one:

1. Add the name to `QUESTION_TYPES` in `src/schema.mjs` and normalize its
   options in `normalizeQuestion`.
2. Add validation in the `validateQuestion` function in `src/ui.html`.
3. Add a render branch in `questionHtml` in `src/ui.html`.
4. Add a case to `buildOutput` in `src/ui.html`.
5. Add a test in `test/smoke.test.mjs`.

## Tests

`npm test` runs the Node test runner. Keep the suite fast and dependency-free.
For non-trivial logic, leave at least one check that fails if the logic breaks.

## Pull requests

- Keep the change focused; one thing per PR.
- Run `npm test` before opening a PR.
- Match the existing style: no frameworks, no build step, plain modern JS.
- Say what you changed and why in the description. Screenshots for UI changes
  are very welcome.

## Ideas that are up for grabs

See the roadmap in the [README](README.md#roadmap). Conditional logic, a
compact review screen, question-type additions and a standalone binary are all
wanted.
