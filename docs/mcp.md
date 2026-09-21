# MCP setup

`brainstormform mcp` runs a stdio MCP server with four tools and live
notifications. Any MCP-capable agent can use it.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `ask_questions` | the form spec, `open`, `waitSeconds`, `keep` | `{ sessionId, url }` |
| `read_answers` | `sessionId` | answers so far + `{ status, revision, answered }` |
| `add_questions` | `sessionId`, `questions` or `categories` | `{ revision, questionCount }` |
| `wait_for_answers` | `sessionId`, `timeoutSeconds` | final answers after Finish |

`ask_questions` returns as soon as the form is live unless you pass
`waitSeconds`, which blocks up to that long for the user to finish.

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
