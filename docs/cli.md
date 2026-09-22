# CLI reference

```
brainstormform <command> [options]
```

## ask

Start a form and print its URL. Returns immediately.

```bash
brainstormform ask questions.json --open
# {"sessionId":"bf-...","url":"http://127.0.0.1:PORT/s/TOKEN","pid":1234}
```

Reads from a file, or from stdin when passed `-` or nothing.

| Flag | Meaning |
| --- | --- |
| `--open` / `--no-open` | Open the browser (default: open) |
| `--keep` | Copy the session, with uploads, to `./brainstormform-<id>/` |
| `--out [dir]` | Write questions, uploads and answers to `dir` (default `.brainstormform/<id>/`), with repo-relative paths |
| `--commit` | With `--out`, `git add` + commit the result |
| `--archive` | Copy the session to `$XDG_STATE_HOME/brainstormform/<id>/` and append to the archive index |
| `--force` | Allow `--out`/`export` to overwrite a non-empty directory |
| `--from <id>` | Seed the new form's defaults with a past session's answers |
| `--preset <name>` | Load a bundled question bank instead of a file (try `discovery`) |
| `--on-submit "cmd"` | Run a shell command when the user presses Finish |
| `--idle-timeout s` | Shut the server down after this long with no activity (default 3600) |
| `--max-upload MB` | Per-file upload limit (default 25) |

## progress

Print what the user has answered so far, without ending the session.

```bash
brainstormform progress bf-...
# { sessionId, status, revision, progressRevision, changed, answered, answers, other, notes, skipped, url }

brainstormform progress bf-... --since 4   # only what changed since progressRevision 4
```

The server increments `progressRevision` on every save and records which question
ids changed. `--since` returns just those (empty when already up to date); if the
gap is larger than one revision it returns the full answers so nothing is lost.
`--format json|md` works here too.

## add

Append questions to a running form. The user sees them appear immediately.

```bash
brainstormform add bf-... /tmp/followups.json
# { "revision": 2, "questionCount": 7 }
```

The fragment can be an array of questions, or `{ "questions": [...] }`, or
`{ "categories": [...] }`. Existing questions cannot be changed. Appending after
the user has finished returns an error (exit 4) — start a new session instead.

## wait / get

```bash
brainstormform wait bf-... --timeout 600   # block until Finish, print answers
brainstormform get bf-...                  # non-blocking poll (exit 4 while open)
```

`wait` exits `3` on timeout (call it again) and `5` if the server exited.
`--timeout 0` returns immediately, which is handy for polling without blocking.
`wait`, `get` and `export` accept `--format json|md` for a compact or Markdown
answer payload.

## export / archive

```bash
brainstormform export bf-... --to ./answers   # materialise a finished session
brainstormform export bf-... --to ./answers --force
brainstormform archive list                   # list archived sessions
```

## install-skill

Install the agent skill that tells agents when to use Brainstormform instead of
their built-in question tool. It also installs the bundled superpowers
`brainstorming` skill (see [install.md](install.md)) unless a copy is already
present.

```bash
brainstormform install-skill                       # all detected agents
brainstormform install-skill --target agents       # ~/.agents/skills
brainstormform install-skill --target opencode     # ~/.config/opencode/skills
brainstormform install-skill --target claude       # ~/.claude/skills
brainstormform install-skill --dir ./skills        # anywhere
```

## Session management

| Command | Purpose |
| --- | --- |
| `list` | Active and finished sessions |
| `stop <id>` | Kill the server and delete the session |
| `resume <id>` | Restart the server for a session whose process exited |
| `cleanup` | Remove dead, unsubmitted sessions |

## Other

`mcp` (run as an MCP server), `schema`, `guide`, `version`, `help`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error (bad input, unknown session) |
| `3` | `wait` timed out |
| `4` | Session still open / append rejected because it is closed |
| `5` | Server exited before submission |
