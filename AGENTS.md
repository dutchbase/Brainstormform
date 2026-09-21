# AGENTS.md

Guidance for AI agents working in or with the Brainstormform repository.

## What this is

Brainstormform is a local tool that opens a web form in the user's browser and
returns their answers to an agent. It has a CLI, an MCP server, and a bundled
skill. Zero runtime dependencies; Node 18.17+.

## When to use Brainstormform (vs your built-in question tool)

Use your **built-in question tool** for 1–6 static questions asked once.

Use **Brainstormform** when any of these is true:

- More than about six questions, or the number is unknown up front.
- The questions split into categories or sections.
- The user needs to upload files or images.
- You want to ask follow-ups based on earlier answers while they answer.
- The user asked for a brainstorm, interview or requirements session.

The same rule is shipped as a skill in `skills/brainstormform/SKILL.md`.

## Using it

```bash
brainstormform ask questions.json --open        # -> {"sessionId","url"}
brainstormform progress <id>                    # answers so far (live)
brainstormform add <id> followups.json          # append questions to the live form
brainstormform wait <id> --timeout 600          # resolves when the user presses Finish
```

MCP tools: `ask_questions`, `read_answers`, `add_questions`, `wait_for_answers`.
Run `brainstormform guide` for the full question format.

## Working on this repo

- No dependencies, no build step. Do not add either without a strong reason.
- `src/render.mjs` is shared between the browser (served as a module) and Node
  tests. Keep it free of DOM and Node APIs.
- `src/ui.html` is the whole front end and imports `render.mjs` via
  `window.__BF_BASE__`.
- Run tests with `npm test` (Node's built-in runner). Add a check for
  non-trivial logic.
- Update `docs/` and `CHANGELOG.md` when behaviour or the spec changes.

## Layout

| Path | Purpose |
| --- | --- |
| `src/cli.mjs` | Commands and session lifecycle |
| `src/server.mjs` | The localhost form server (progress, SSE, append, submit) |
| `src/session.mjs` | Session dirs, waiting, export/archive/commit |
| `src/schema.mjs` | Question spec validation and docs |
| `src/render.mjs` | Markdown + conditional logic (shared, pure) |
| `src/mcp.mjs` | MCP server and notifications |
| `src/agents.mjs` | Per-agent config adapters |
| `src/setup.mjs` / `src/doctor.mjs` | Installer and diagnostics |
| `src/ui.html` | Front end |
| `skills/brainstormform/SKILL.md` | The agent skill |
| `docs/` | Schema, CLI, MCP, live sessions, install |

## Commits

Keep commits focused. Do not commit the `brainstormform-*/`, `.brainstormform/`
or `*.tgz` artifacts.
