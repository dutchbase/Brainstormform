# Brainstormform

Local web forms that let AI agents ask **unlimited** brainstorming questions in
one go. The agent writes a JSON spec, Brainstormform opens a paginated form in
the browser (choice, text, scale, boolean, file upload), the user submits, and
the CLI hands the answers back as JSON.

Zero dependencies. Node 18.17+. Nothing leaves the machine.

## Quick start

```bash
node bin/brainstormform guide                 # full spec format + example
node bin/brainstormform ask examples/questions.json --open
# -> {"sessionId":"bf-...","url":"http://127.0.0.1:PORT/s/TOKEN","pid":123}
node bin/brainstormform wait bf-... --timeout 600   # prints answers JSON
```

Install globally if you like: `npm link` (or `npm i -g .`), then just
`brainstormform ...`.

## Why a local server?

Answers and uploaded files must travel from a browser tab back to a CLI process.
Browsers cannot write arbitrary files or signal a CLI. A throwaway server bound
to `127.0.0.1` (random port, random token) is the only approach that makes this
automatic and cross-browser, and it handles file uploads for free. It shuts
down when the answers are read, and session data is deleted at that point.

## Commands

| Command | Purpose |
| --- | --- |
| `ask [file\|-]` | Read spec (file or stdin), start the form, print `{sessionId,url,pid}` |
| `wait <id> [--timeout s]` | Block until submit; print answers JSON (exit 3 on timeout — call again) |
| `get <id>` | Non-blocking poll (exit 4 while pending) |
| `list` / `stop <id>` / `cleanup` | Inspect and reap sessions |
| `schema` / `guide` | JSON Schema and a complete usage cheat sheet |
| `mcp` | Run as an MCP stdio server |

`ask` flags: `--open` (default) / `--no-open`, `--keep`, `--idle-timeout s`,
`--max-upload MB`.

## Question format

Top level: `title`, `intro?`, `settings { pageSize, theme, submitLabel }`, and
either `categories: [{ title, description?, questions: [...] }]` or a flat
`questions: [...]`.

Question types:

- `single`, `multi` — `options: [{ value, label?, description? }]`, `allowOther?`
- `text`, `textarea` — `placeholder?`
- `number` — `min`, `max`, `step?`
- `scale` — `min`, `max`, `scaleLabels?` (default 1–5)
- `boolean`
- `file` — `accept?`, `multiple?`, `maxFiles?`

Every question takes `id?` (auto `q1..qN`), `label`, `help?`, `required?`.

Run `brainstormform guide` for a filled-in example, or see
[`examples/questions.json`](examples/questions.json).

## Answers output

```json
{
  "sessionId": "bf-...",
  "submittedAt": "2026-01-01T00:00:00.000Z",
  "durationMs": 42000,
  "answers": {
    "goal":      { "type": "textarea", "value": "Ship v1" },
    "platforms": { "type": "multi", "value": ["web","ios"], "other": "desktop" },
    "urgency":   { "type": "scale", "value": 4 },
    "references":{ "type": "file", "value": [{ "name":"x.png", "path":"/abs/path", "size":123, "mime":"image/png" }] }
  },
  "unanswered": ["..."]
}
```

## MCP setup

`brainstormform mcp` exposes two tools: `ask_questions` and `get_answers`.

Claude Code:

```bash
claude mcp add brainstormform -- node /abs/path/to/brainstorm-ui/bin/brainstormform mcp
```

opencode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "brainstormform": {
      "type": "local",
      "command": ["node", "/abs/path/to/brainstorm-ui/bin/brainstormform", "mcp"],
      "enabled": true
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.brainstormform]
command = "node"
args = ["/abs/path/to/brainstorm-ui/bin/brainstormform", "mcp"]
```

Typical MCP call:

```
ask_questions({ title, categories, open: true })      -> { sessionId, url }
get_answers({ sessionId, timeoutSeconds: 600 })        -> answers
```

## Storage & privacy

- Session data lives in `$XDG_RUNTIME_DIR/brainstormform/<id>/` (falls back to
  the OS temp dir).
- It is deleted as soon as the agent reads the answers, unless `--keep` copies
  it (with uploads) to `./brainstormform-<id>/`.
- The user can always download JSON/Markdown from the form's success screen.
- Server binds `127.0.0.1` only, requires a random token, rejects foreign Host
  headers, and caps upload sizes.

## Tests

```bash
npm test
```

## Roadmap

Priories come from dogfooding this tool with real brainstorming sessions. Near
term:

- **Conditional logic** — show a question only when earlier answers match.
- **More question types** — ranking, matrix, date/time, visual/image choice.
- **Richer questions** — Markdown in labels/help, links opening in new tabs,
  a heading + intro per category, placeholder suggestions.
- **Compact review screen** before submitting.
- **Optional local archive** of past brainstorms, and saving uploads into the
  repo, with a "write answers into the repo" export.
- **MCP push notifications** so an agent can be told when answers are ready
  instead of polling.
- **A standalone binary** so Brainstormform runs without Node installed.

Out of scope: remote/hosted use, multi-user forms and anything that stops the
tool being local-first. Local-only is the security model.

## Contributing

Contributions are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). It is
a small, dependency-free codebase, so it is easy to get started.

## License

[MIT](LICENSE)

