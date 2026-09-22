# Live sessions

A Brainstormform session is not a one-shot form. Answers are saved to the local
server as the user types, an agent can read them and add questions while the user
is still answering, and the agent is only told the session is done when the user
presses **Finish**.

## The loop

```
agent: ask          -> form opens, user starts answering
user:  answers...      (saved continuously on the server)
agent: progress     -> sees answers so far
agent: add          -> appends follow-ups; they appear in the open form
user:  answers...      (existing answers and position are preserved)
agent: progress     -> reads again, adds more if useful
user:  Finish       -> agent's wait resolves with the final answers
```

This lets an agent run a real interview: start broad, then ask targeted
follow-ups based on what the user actually said. A form can also do this on its
own: a question's `then` rule appends follow-ups when an answer matches, with no
agent in the loop (see [schema.md](schema.md)).

## CLI

```bash
brainstormform ask questions.json --open     # {"sessionId":"bf-...","url":"..."}
brainstormform progress <id>                 # draft answers + status
brainstormform progress <id> --since 4       # also list the ids changed since progressRevision 4
brainstormform add <id> followups.json       # append questions
brainstormform wait <id> --timeout 600       # resolves on Finish
```

`answers` is always the full current answers — reading with `--since` can never
make earlier answers look lost. The server records which question ids changed on
every save and `--since` narrows the separate `changed` list to those, so a poll
can still cheaply tell what is new.

## MCP

```
ask_questions({ title, categories, open: true })   -> { sessionId, url }
read_answers({ sessionId, format: "json" })         -> compact answers so far
add_questions({ sessionId, questions: [...] })      -> { revision, questionCount }
wait_for_answers({ sessionId, timeoutSeconds: 600 })-> final answers
```

`read_answers` also accepts `since:<progressRevision>`; `answers` stays the full
current set and `changed` lists the ids updated after that revision. `format` may
be `full` (default), `json` or `md`.

## How it works

Each session runs a short-lived HTTP server on `127.0.0.1` with a random token.

| Route | Purpose |
| --- | --- |
| `GET /api/questions` | current spec, revision and status |
| `GET /api/progress` | answers saved so far |
| `POST /api/progress` | the browser saves drafts here |
| `GET /api/events` | SSE stream: `hello`, `state`, `appended` |
| `POST /api/append` | the agent appends questions |
| `POST /api/submit` | the user pressed Finish |
| `POST /api/upload` | file uploads |

The browser subscribes to `/api/events`. When the agent appends questions the
server broadcasts an `appended` event, and the open form merges the new questions
in place. If the stream drops, the page still works and can be reloaded.

For environments where a long-lived connection is unwelcome (automated
screenshots, restricted proxies) append `?nostream=1` to the form URL to skip the
event stream; the form then only reflects the questions present at load.

## Rules

- **Append only.** Existing questions stay stable so answers never get orphaned.
- **Finish closes the session.** Appending afterwards returns `409`; start a new
  session for another round.
- **Finish is always available**, on any page, because the form can grow while
  the user answers.
- **Drafts are ephemeral.** `progress.json` lives in the session directory and is
  deleted with it. Only the final answers follow your `--keep` / `--out` /
  `--archive` settings.
- **Notes.** Every question accepts an optional free-text note. Notes are saved
  like answers, returned in the `notes` map keyed by question id, and are the
  right place for the user to qualify an answer or say why no option fits.
