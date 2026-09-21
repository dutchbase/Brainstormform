# Promoting Brainstormform

A working checklist plus copy you can paste. Nothing here posts for you — pick
and choose, and keep it honest: this is a small local tool, so lead with the
problem it solves rather than hype.

## One-liner

> Brainstormform lets an AI agent ask you as many questions as it needs through a
> live local web form, and get the answers back as JSON.

## Short description

> Coding agents can only ask a handful of questions at a time. Brainstormform
> gives them a real form instead: sections, file uploads, conditional questions
> and follow-ups they can add while you are still answering. It runs on
> `127.0.0.1`, has zero dependencies, and works with any MCP client (Claude Code,
> Codex, opencode).

## Before you post

- [ ] `npm login` then `npm publish --access public` (needed for `npx brainstormform`).
- [ ] Add an `NPM_TOKEN` repo secret so the Publish workflow works on future tags.
- [ ] Upload `docs/assets/social-preview.png` in repo Settings → Social preview.
- [ ] Star the repo yourself; make sure the GIF and CI badge render on GitHub.
- [ ] Record a 20–40s screen capture (the README GIF is a start) if you have a moment.
- [ ] Pick one primary channel for launch day; do not blast five at once.

## Channels, in rough order of payoff

| Channel | Why | Effort |
| --- | --- | --- |
| MCP directories (awesome lists, registries) | People search where they already are | Low, one-time PRs |
| Reddit (r/ClaudeAI, r/LocalLLaMA, r/mcp) | Where agent users hang out | Low |
| Show HN | Best for genuinely useful dev tools | Medium, be around to reply |
| X / Twitter | Fast, good with the GIF | Low |
| Product Hunt | Broad but noisy; needs a polished page | Medium |
| Dev.to / blog | Lasting SEO and a place to link | Medium |

## Show HN

**Title**

```
Show HN: Brainstormform – a local web form that lets AI agents ask any number of questions
```

**Text**

```
Coding agents can usually ask about 5 questions per round, from a list of
choices. That's fine for a quick decision, but useless for planning: no
sections, no file uploads, no follow-ups.

Brainstormform is a small local tool that opens a real form in your browser
instead. The agent writes a JSON question spec, the form opens on 127.0.0.1,
and the answers come back as JSON.

It also does live sessions: answers save as you type, the agent can read them
and append new questions to the open form, and it only gets the "done" signal
when you press Finish.

Zero runtime dependencies, Node 18+. Works with Claude Code, Codex and opencode
over MCP, or with any agent that can run a shell command.

https://github.com/dutchbase/Brainstormform

Happy to answer anything about how it works.
```

**First comment (post yourself)**

```
A few design notes:

- It uses a throwaway localhost server rather than a browser-only page. Answers
  and uploads have to get back to a CLI process, and a local server is the only
  way that works in every browser without a save dialog.
- Nothing leaves the machine. It binds 127.0.0.1, uses a random port and token,
  rejects foreign Host headers, and deletes the session as soon as the agent
  reads it.
- The question spec supports single/multi choice, image cards, text, number,
  rating scale, boolean and file uploads, plus conditional `showIf`.

Feedback very welcome, especially on where the question limit actually hurts.
```

## X / Twitter thread

```
1/ AI agents can only ask ~5 questions before they run out of room. That breaks
   any real planning session.

   Brainstormform gives them a proper form instead: unlimited questions,
   sections, file uploads, live follow-ups. Local, zero deps.

   [attach docs/assets/demo.gif]

2/ The agent writes a JSON spec and opens the form:

   brainstormform ask questions.json --open

   It gets back a sessionId + url. You answer in the browser.

3/ The part I like: live sessions.

   Answers save as you type.
   The agent can read progress.
   It can append follow-up questions to the open form.
   It only gets "done" when you press Finish.

4/ Works with Claude Code, Codex, opencode and any MCP client. One command:

   curl -fsSL https://raw.githubusercontent.com/dutchbase/Brainstormform/main/install.sh | sh
   brainstormform setup

5/ MIT, zero runtime dependencies, Node 18+, nothing leaves your machine.

   github.com/dutchbase/Brainstormform

   Stars and feedback appreciated.
```

## Reddit

Post the same body to the relevant subreddit; adjust the intro line each time.
Do not cross-post within minutes — space them out.

**r/ClaudeAI / r/opencode / r/Codex** — title:

```
I built a local web form so coding agents can ask unlimited questions (with live follow-ups)
```

**r/mcp** — title:

```
Brainstormform: an MCP server that opens a local form so agents can ask any number of questions
```

**Body**

```
Like a lot of you, I got tired of the built-in "ask the user" tool capping out
at a handful of questions. For a real brainstorm it falls apart: no sections, no
file uploads, and no way to follow up on what I just said.

So I built Brainstormform. The agent writes a JSON spec of questions, and it
opens a paginated form in my browser. I answer, press Finish, and the answers
come back as JSON.

The bit that turned out to be most useful is that it's live. Answers save as you
type, and the agent can read them and add follow-up questions to the form while
I'm still filling it in. It only knows I'm done when I press Finish.

- Local only: 127.0.0.1, random port + token, deleted when read
- Zero runtime dependencies, Node 18+
- Types: single/multi choice, image cards, text, number, scale, boolean, file
- Conditional questions (showIf)
- Works via MCP (Claude Code, Codex, opencode, Cursor, Gemini CLI) and CLI
- MIT

Repo: https://github.com/dutchbase/Brainstormform

It's early, so I'd love feedback — especially if the ~5 question limit has bitten
you and how. Happy to answer questions.
```

## Product Hunt

**Tagline**

```
Unlimited questions for AI agents, in a live local form
```

**Description**

```
Brainstormform opens a real web form so your AI agent can ask as many questions
as it needs — not just five. Sections, file uploads, image choices, conditional
questions, and follow-ups the agent can add while you are still answering.
Answers come back as JSON. Runs locally, zero dependencies, MIT.
```

**First comment**

```
I built this because agent question tools are great for a quick decision and
useless for planning. Brainstormform is what I wanted: a form the agent writes,
that I fill in at my own pace, with the agent reading as I go and adding
follow-ups. Clicking Finish is the only "done" signal. Would love your feedback.
```

## Directories and registries

Open a PR (not an issue) for each list. Keep the entry on one line.

**Official MCP registry** — publish the npm package first, then submit with the
`mcp-publisher` CLI and a `server.json`:

```json
{
  "name": "io.github.dutchbase/brainstormform",
  "description": "Local web forms for AI agents to ask unlimited brainstorming questions.",
  "repository": { "url": "https://github.com/dutchbase/Brainstormform", "source": "github" },
  "packages": [{ "registryType": "npm", "identifier": "brainstormform", "transport": { "type": "stdio" } }]
}
```

**awesome-mcp-servers** entry (pick the best-fit section, likely Developer Tools
or Collaboration):

```markdown
- [dutchbase/Brainstormform](https://github.com/dutchbase/Brainstormform) - Local web forms that let an agent ask unlimited, categorized questions, read answers live and append follow-ups. Zero dependencies.
```

Other lists worth a PR: `wong2/awesome-mcp-servers`, `awesome-ai-agents`,
`awesome-claude-code`, `awesome-codex`. Search for the list, follow its
contributing guide, add one line.

## Blog / Dev.to outline

Title: **Why your AI agent should ask more questions**

1. The 5-question ceiling and when it breaks.
2. What a form gives you that a chat prompt does not (sections, files, scale,
   conditionals).
3. Live sessions: reading answers and appending follow-ups mid-form.
4. A worked example: `ask` → `progress` → `add` → `wait`, with the JSON.
5. MCP setup in one command.
6. Local-first design and why a throwaway server is the right call.
7. What is next, and an invitation to contribute.

## Etiquette

- Reply to everyone on launch day; that is most of the value.
- Do not ask for stars in the first line; earn them with the demo.
- If someone reports a bug, fix or file it before the thread goes quiet.
