# Question format

A form is a JSON spec. Pass it to `brainstormform ask` (from a file or stdin).

## Top level

```jsonc
{
  "title": "Project kickoff",          // required
  "intro": "Optional **Markdown** intro shown at the top.",
  "settings": {
    "pageSize": 5,                     // questions per page (default 5)
    "theme": "auto",                   // auto | light | dark
    "submitLabel": "Continue",         // label for the Next button
    "finishLabel": "Finish"            // label for the Finish button
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
| `content` | all | longer Markdown block |
| `placeholder` | text, number | grey hint text |
| `showIf` | all | conditional visibility (below) |

### Types

| Type | Extra fields |
| --- | --- |
| `single` | `options`, `allowOther` |
| `multi` | `options`, `allowOther` |
| `visual` | `options` with `image`, `multiple` |
| `text` / `textarea` | |
| `number` | `min`, `max`, `step` (required) |
| `scale` | `min`, `max`, `scaleLabels` (default 1–5) |
| `boolean` | |
| `file` | `accept`, `multiple`, `maxFiles` |

Options look like:

```jsonc
{ "value": "ios", "label": "iOS", "description": "Optional extra line" }
```

For `visual`, each option also needs an `image`: an `https://` URL or a path to a
local file. Local files are served through a safe, whitelisted route — the
browser never reads arbitrary paths.

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

### Markdown

`label`, `intro`, `content`, option labels and descriptions, and category intros
support a small Markdown subset: `**bold**`, `*italic*`, `` `code` ``,
`[links](https://…)`, `- lists` and `# headings`. Links open in a new tab. Raw
HTML is escaped and only `http`, `https` and `mailto` links are allowed.

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
  "skipped": ["notes"],
  "unanswered": [],
  "hidden": ["appstore"]
}
```

- `skipped` — optional questions the user left blank or explicitly skipped.
- `unanswered` — required questions still empty (empty when validation passes).
- `hidden` — questions hidden by `showIf`, excluded from the answers.

## Schema

`brainstormform schema` prints a JSON Schema for tooling.
`brainstormform guide` prints this format with a worked example.
