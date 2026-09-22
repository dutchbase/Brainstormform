# MCP setup

`brainstormform mcp` runs a stdio MCP server with four tools and live
notifications. Any MCP-capable agent can use it.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `ask_questions` | the form spec, `open`, `waitSeconds`, `keep`, `preset`, `saveAsProfile` | `{ sessionId, url, profile }` |
| `read_answers` | `sessionId`, `format?`, `since?` | answers so far + `{ status, revision, answered, notes }` |
| `add_questions` | `sessionId`, `questions` or `categories` | `{ revision, questionCount }` |
| `wait_for_answers` | `sessionId`, `timeoutSeconds`, `format?` | final answers after Finish |
| `get_profile` | — | `{ configured, profile, path, summary }` |

`ask_questions` returns as soon as the form is live unless you pass
`waitSeconds`, which blocks up to that long for the user to finish.
`wait_for_answers` accepts `timeoutSeconds` (default 600); pass `0` to return
immediately and poll instead of blocking.

To keep responses small, pass `format: "json"` for a compact
`{ answers: { id: value }, notes? }` map, or `format: "md"` for a Markdown
summary. `read_answers` also takes `since: <progressRevision>` to return only
what changed since a previous read. Results are sent as compact JSON text.

Typical flow:

```
ask_questions({ title, categories, open: true })   -> { sessionId, url }
read_answers({ sessionId })                         -> what they answered so far
add_questions({ sessionId, questions: [...] })      -> follow-ups appear live
wait_for_answers({ sessionId, timeoutSeconds: 600 })-> final answers after Finish
```

## Notifications

The server advertises the `resources` capability and exposes each open session
as `brainstormform://session/<id>`. It sends:

- `notifications/resources/updated` when answers change or the session is submitted.
- `notifications/message` log lines (`progress` / `submitted`).

Clients that do not surface notifications can poll `read_answers` instead — it
always works.

A static `brainstormform://guide` resource returns the full question format, so
the tool descriptions can stay short. `brainstormform://profile` returns the
[user profile](profile.md), and the `get_profile` tool returns it with a short
summary. When no profile exists, onboard with
`ask_questions({ preset: "profile", saveAsProfile: true })`.

Questions accept an optional `explanation` — a Markdown context block with links
and images (`content` is an alias). Images may be `https://` URLs or local files
under the directory `ask` runs from.

## Client config

Claude Code:

```bash
claude mcp add brainstormform -- node /abs/path/to/brainstormform/bin/brainstormform mcp
```

opencode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "brainstormform": {
      "type": "local",
      "command": ["node", "/abs/path/to/brainstormform/bin/brainstormform", "mcp"],
      "enabled": true
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.brainstormform]
command = "node"
args = ["/abs/path/to/brainstormform/bin/brainstormform", "mcp"]
```

## Skill

Install the companion skill so the agent knows *when* to reach for
Brainstormform instead of its built-in question tool:

```bash
brainstormform install-skill
```

See [`skills/brainstormform/SKILL.md`](../skills/brainstormform/SKILL.md).
