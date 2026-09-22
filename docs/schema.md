# Question format

A form is a JSON spec. Pass it to `brainstormform ask` (from a file or stdin).

## Top level

```jsonc
{
  "title": "Project kickoff",          // optional, defaults to "Brainstorm"
  "intro": "Optional **Markdown** intro shown at the top.",
  "settings": {
    "pageSize": 5,                     // questions per page (default 5)
    "theme": "auto",                   // auto | light | dark
    "submitLabel": "Continue",         // label for the Next button
    "finishLabel": "Finish",           // label for the Finish button
    "scaleStyle": "buttons",           // buttons | slider
    "autoAdvance": false               // advance after a single-choice answer
  },
  "categories": [
    {
      "title": "Scope",                // required when using categories
      "intro": "Optional Markdown shown under the heading.",
      "questions": [ /* ... */ ]
    }
  ]
}
```

A flat `"questions": [ ... ]` array is also accepted and is wrapped in a single
category titled after the form.

## Questions

Every question needs a `type` and a `label`.

| Field | Applies to | Notes |
| --- | --- | --- |
| `id` | all | auto `q1..qN`; used in `showIf` and the answers |
| `required` | all | default `false` |
| `intro` | all | short Markdown help under the label |
| `explanation` | all | Markdown context block; supports links and images |
| `content` | all | alias for `explanation` |
| `placeholder` | text, number | grey hint text |
| `showIf` | all | conditional visibility (below) |
| `then` | all | append follow-ups when an answer matches (below) |

### Types

| Type | Extra fields |
| --- | --- |
| `single` | `options`, `allowOther` |
| `multi` | `options`, `allowOther` |
| `visual` | `options` with `image`, `multiple` |
| `text` / `textarea` | |
| `number` | `min`, `max` (required), `step` (default 1) |
| `scale` | `min`, `max`, `scaleLabels` (default 1–5) |
| `boolean` | |
| `file` | `accept`, `multiple`, `maxFiles` |
| `matrix` | `rows`, `columns` (both `[{ value, label }]` or plain strings) |
| `rank` | at least two `options`; the user reorders them |

A `matrix` answer is an object keyed by row value: `{ "speed": "High" }`. A
`rank` answer is the ordered array of option values.

Options look like:

```jsonc
{ "value": "ios", "label": "iOS", "description": "Optional extra line" }
```

For `visual`, each option also needs an `image`: an `https://` URL or a path to a
local file. Local paths are resolved relative to the directory you run `ask`
from and must stay inside it; they are served through a safe, whitelisted route
so the browser never reads arbitrary paths.

### Conditional questions (`showIf`)

Show a question only when an earlier answer matches. The referenced question must
appear **before** this one.

```jsonc
{ "showIf": { "question": "platforms", "contains": "ios" } }
```

| Operator | Matches when |
| --- | --- |
| `equals` | the answer equals the value |
| `not` | the answer does not equal the value |
| `in` | the answer is one of an array of values |
| `contains` | a multi/visual answer includes the value |
| `answered` | the question has any answer (`true`) or none (`false`) |

### Adaptive follow-ups (`then`)

The form can append questions itself when an answer matches, without the agent
polling. `then` takes the same operators as `showIf` (using `equals`/`not`/`in`/
`contains`/`answered`) plus an `add` array of questions:

```jsonc
{
  "id": "pets",
  "type": "boolean",
  "label": "Do you have pets?",
  "then": {
    "question": "pets",
    "equals": true,
    "add": [{ "id": "petnames", "type": "text", "label": "What are their names?" }]
  }
}
```

A rule can reference its own question. Follow-ups are appended once, the moment
the condition first matches, and the open form receives them live.

### Markdown

`label`, `intro`, `explanation`, option labels and descriptions, and category
intros support a small Markdown subset: `**bold**`, `*italic*`, `` `code` ``,
`[links](https://…)`, `![images](…)`, `- lists` and `# headings`. Links and
images open in a new tab. Raw HTML is escaped and only `http`, `https` and
`mailto` links are allowed.

Images may be an `https://` URL, a `data:image/…` URI, or a path to a local file
under the directory you run `ask` from (image extensions only). Local files are
served through the same safe, whitelisted route as `visual` option images, so the
browser never reads arbitrary paths.

```jsonc
{ "explanation": "Here is the layout we sketched:\n\n![wireframe](./wireframe.png)" }
```

## Answers output

When the user presses Finish, `brainstormform wait` prints:

```json
{
  "sessionId": "bf-...",
  "submittedAt": "2026-01-01T00:00:00.000Z",
  "durationMs": 42000,
  "answers": {
    "goal":      { "type": "textarea", "value": "Ship v1" },
    "platforms": { "type": "multi", "value": ["web","ios"], "other": "desktop" },
    "urgency":   { "type": "scale", "value": 4 },
    "mood":      { "type": "visual", "value": "minimal" },
    "references":{ "type": "file", "value": [{ "name":"x.png", "path":"/abs/path", "size":123, "mime":"image/png" }] }
  },
  "notes": { "platforms": "mostly web, iOS later" },
  "skipped": ["notes"],
  "unanswered": [],
  "hidden": ["appstore"]
}
```

- `skipped` — optional questions the user left blank or explicitly skipped.
- `unanswered` — required questions still empty (empty when validation passes).
- `hidden` — questions hidden by `showIf`, excluded from the answers.
- `notes` — free-text annotations keyed by question id. Every question offers an
  "Add a note" control, so a user can qualify an answer or explain why none of
  the options fit. Agents should read these alongside the answers.

For lower-token reads, `wait`, `get`, `progress` and `export` accept
`--format json` (a compact `{ answers: { id: value }, notes? }` map) or
`--format md` (a Markdown summary). The default `full` shape above is unchanged.

## Schema

`brainstormform schema` prints a JSON Schema for tooling.
`brainstormform guide` prints this format with a worked example.
