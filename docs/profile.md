# User profile

Agents write better questions when they know who is answering. Brainstormform
keeps a small, machine-wide profile so every agent and every session can tailor
its wording to you — a senior developer gets terse, technical questions while a
new vibecoder gets plain language, more context and examples.

## Where it lives

```
~/.config/brainstormform/profile.json      # or $XDG_CONFIG_HOME/brainstormform/
```

One file, local only, shared across sessions and agents. It is created the first
time a profile is saved (from the settings menu or the onboarding form) and is
written atomically.

## Fields

Every field is optional.

| Field | Values | Meaning |
| --- | --- | --- |
| `name` | text | what the agent should call you |
| `role` | text | e.g. indie hacker, backend engineer, student |
| `experience` | `new` · `learning` · `professional` · `senior` · `expert` | how much coding experience you have |
| `background` | text | languages, frameworks, tools, domains you know |
| `language` | text | language questions and answers should be written in |
| `languageLevel` | `plain` · `standard` · `technical` | how simply/technically to phrase things |
| `detail` | `brief` · `normal` · `detailed` | how much detail you want |
| `examples` | boolean | include concrete examples? |
| `notes` | text | anything else, e.g. "explain acronyms" |
| `version` | `1` | schema version (set automatically) |
| `updatedAt` | ISO string | last edit (set automatically) |

## The settings menu

Every form has a **⚙** button in the header. It opens a panel to view and edit
your profile; changes are saved immediately and apply to every future session and
agent. "Clear" removes the profile.

## CLI

```bash
brainstormform profile                      # read profile + a short summary
brainstormform profile path                 # print the file path
printf '{"experience":"senior"}' | brainstormform profile set -   # write it
brainstormform profile clear                # remove it
```

## MCP

- `get_profile` → `{ configured, profile, path, summary }`
- resource `brainstormform://profile` → the raw profile JSON

`ask_questions` accepts `preset: "profile"` and `saveAsProfile: true` so the
agent can collect the profile in a form and store it in one step.

## Onboarding when no profile exists

`ask` returns a short `profile` summary and a `profileHint`. If the profile is
not set, the agent asks for one first:

```bash
brainstormform ask --preset profile --save-profile --open
brainstormform wait bf-...
```

The bundled `profile` preset defines questions whose ids match the fields above;
on submit the server writes them straight to the profile file. MCP agents use
`ask_questions({ preset: "profile", saveAsProfile: true })`.

Agents are told (in `skills/brainstormform/SKILL.md`) to read the full profile
once before writing questions and to tailor by `experience`, `languageLevel`,
`detail`, `examples` and `language`. Follow-up forms in the same session reuse
the profile already in context, so it is not fetched again.
