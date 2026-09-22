---
name: brainstormform
description: Decide between an agent's built-in question tool and Brainstormform, and drive the Brainstormform live form. Use when a task needs user input during planning or brainstorming — requirements gathering, scope decisions, design choices, naming, prioritisation, or any "ask the user" moment. Also use for "ask me questions", "brainstorm this with me", "interview me", "I want to answer a lot of questions", "let me pick from options", "collect my preferences", "ask follow-ups based on my answers", or when a single question needs file or image uploads.
---

# Brainstormform

Brainstormform opens a paginated web form on `127.0.0.1` where a user answers any
number of questions. Answers are saved as the user types, you can read them
mid-session and append follow-ups, and you only get the "done" signal when the
user presses Finish.

## Pair with the brainstorming skill (recommended)

For creative work, the **brainstorming skill** (superpowers: `brainstorming`) is
a useful front end: it helps classify the task and draw out intent, requirements
and design before you build. You are not required to use it — reach for it when
the task warrants it. When you do, Brainstormform is the question surface:
instead of asking clarifying questions one at a time, open a live form so the
user can answer them all in one sitting, with categories, files and conditional
follow-ups.

If the brainstorming skill is not installed, Brainstormform provides a copy.
`brainstormform install-skill` installs both skills into your agent's skill
directory (the bundled brainstorming copy is skipped when one is already there).

## Personalize the questions

Before writing questions, know who you are writing them for.

- `ask`/`ask_questions` returns a short `profile` summary. Read the **full**
  profile once with `brainstormform profile` (CLI) or `get_profile` (MCP), and
  tailor wording to it. For follow-up forms in the same session the profile is
  already in your context — do not fetch it again.
- No profile yet (`configured: false`, or `profile.profileHint` says so)? Ask for
  one first, then continue:

  ```bash
  brainstormform ask --preset profile --save-profile --open
  brainstormform wait bf-...
  ```

  MCP: `ask_questions({ preset: "profile", saveAsProfile: true })`.

- Tailor by `experience`: `new`/`learning` → plain language, define jargon, add
  context and examples, split the hard questions into smaller ones; `professional`
  → normal technical language; `senior`/`expert` → terse and precise, skip basics.
- Honour `languageLevel` (`plain`/`standard`/`technical`), `detail`
  (`brief`/`normal`/`detailed`) and `examples`.
- Write question text in the profile's `language` when set.

## First: pick the right tool

Use the **built-in question tool** when the exchange is small and static:

- 1–6 questions, asked once.
- No categories, no file uploads, no follow-ups.
- A quick yes/no or "pick one of three" during ordinary work.

Use **Brainstormform** when any of these are true:

- More than ~6 questions, or the count is unclear up front.
- The questions naturally split into categories or sections.
- The user needs to upload files or images.
- You want to ask follow-ups **based on** earlier answers while they answer.
- It is a deliberate brainstorming or requirements-gathering session.
- The user asked for it ("ask me lots of questions", "interview me").

Rule of thumb: if you would have to drop good questions to fit the built-in
tool's limit, use Brainstormform instead.

## Check it is available

```bash
brainstormform version
```

If it is missing, fall back to the built-in question tool and say so.

## One-shot form (no follow-ups)

```bash
brainstormform ask questions.json --open
# -> {"sessionId":"bf-...","url":"http://127.0.0.1:PORT/s/TOKEN","pid":123}
brainstormform wait bf-... --timeout 600      # answers JSON on stdout when finished
```

`wait` exits 3 on timeout — just call it again. Add `--format json` for a
compact id→value map or `--format md` for Markdown. The session is deleted once
read unless you pass `--keep`, `--out` or `--archive`.

## Live form (read answers, add follow-ups)

This is the reason to use Brainstormform for a real brainstorm:

```bash
brainstormform ask questions.json --open      # start
brainstormform progress bf-...                # what the user has answered so far
brainstormform progress bf-... --since 4      # also list ids changed since progressRevision 4
brainstormform add bf-... followups.json      # append questions based on their answers
brainstormform wait bf-... --timeout 600      # block until they press Finish
```

Typical loop: start with a broad category, read `progress`, then `add` targeted
follow-ups while the user is still answering. You can repeat this several times.
`ask --from <prevId>` seeds a new form with a past session's answers. Once the
user presses Finish the session closes; if you still need input, start a new
session.

## MCP tools (preferred when available)

- `ask_questions({ title, categories | questions, open })` → `{ sessionId, url }`
- `read_answers({ sessionId, format?, since? })` → answers so far + status
- `add_questions({ sessionId, questions | categories })` → append follow-ups
- `wait_for_answers({ sessionId, timeoutSeconds, format? })` → final answers

Prefer MCP over the CLI so you also receive resource-updated notifications when
the user answers. Read the `brainstormform://guide` resource for the full format.

## Question format

Run `brainstormform guide` for the full format. Summary: `categories` hold
`questions`; types are `single`, `multi`, `visual`, `text`, `textarea`, `number`,
`scale`, `boolean`, `file`, `matrix`, `rank`; `showIf` shows a question
conditionally; every question accepts a free-text `note`.

Give each question an optional `explanation` (Markdown) with the context that
makes it easy to answer: a sentence on why it matters, `[links](https://…)`
(open in a new tab), and images. Images can be `https://` URLs or local files
under the directory you run `ask` from, e.g. `![mockup](./mock.png)` — generate a
mockup or take a screenshot into that directory and reference it. The older name
`content` is an alias for `explanation`.

## Quality rules

- Ask real, decision-ready questions — not filler to hit a count.
- Group related questions into categories.
- Mark only genuinely required questions as `required: true`.
- Prefer `single`/`multi` with concrete options over open text; add `allowOther`
  when options may not cover everything.
- Tell the user they can add a **note** to any question, and read the `notes`
  map in the answers. A single choice often has no clean correct option; the note
  is where the nuance goes, so ask questions that invite it.
- Use `scale` for intensity and `boolean` for yes/no.
- Add `showIf` so the form stays short and relevant.
- Keep `id`s stable and readable; you reference them in `showIf` and answers.
- Do not duplicate what you already know.
