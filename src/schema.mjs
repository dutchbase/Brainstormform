export const VERSION = '0.1.0';

export class SpecError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecError';
  }
}

export const QUESTION_TYPES = ['single', 'multi', 'text', 'textarea', 'number', 'scale', 'boolean', 'file'];
const TYPES = new Set(QUESTION_TYPES);

function slug(value, fallback) {
  const out = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}

function normalizeQuestion(input, where, seen, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError(`${where} must be an object.`);
  }
  if (!TYPES.has(input.type)) {
    throw new SpecError(`${where}.type "${input.type}" is invalid. Allowed: ${QUESTION_TYPES.join(', ')}.`);
  }

  const id = input.id == null ? `q${index}` : String(input.id);
  if (seen.has(id)) throw new SpecError(`Duplicate question id "${id}".`);
  seen.add(id);

  const label = input.label == null ? String(input.title || '') : String(input.label);
  if (!label) throw new SpecError(`${where}.label is required.`);

  const q = { id, type: input.type, label, required: input.required === true };
  if (input.help != null) q.help = String(input.help);
  if (input.placeholder != null) q.placeholder = String(input.placeholder);
  if (input.default !== undefined) q.default = input.default;

  if (input.type === 'single' || input.type === 'multi') {
    if (!Array.isArray(input.options) || input.options.length === 0) {
      throw new SpecError(`${where}.options must be a non-empty array for type "${input.type}".`);
    }
    q.options = input.options.map((opt, i) => {
      const value = opt && typeof opt === 'object' ? opt.value : opt;
      const text = opt && typeof opt === 'object' ? opt.label ?? opt.value : opt;
      if (value == null) throw new SpecError(`${where}.options[${i}] needs a "value".`);
      const out = { value: String(value), label: String(text) };
      if (opt && typeof opt === 'object' && opt.description != null) out.description = String(opt.description);
      return out;
    });
    q.allowOther = input.allowOther === true;
  }

  if (input.type === 'number' || input.type === 'scale') {
    const fallbackMin = input.type === 'scale' ? 1 : undefined;
    const fallbackMax = input.type === 'scale' ? 5 : undefined;
    q.min = Number.isFinite(input.min) ? input.min : fallbackMin;
    q.max = Number.isFinite(input.max) ? input.max : fallbackMax;
    if (q.min === undefined || q.max === undefined) {
      throw new SpecError(`${where} of type "number" requires numeric "min" and "max".`);
    }
    if (q.min >= q.max) throw new SpecError(`${where}.min must be less than max.`);
    q.step = Number.isFinite(input.step) ? input.step : 1;
    if (Array.isArray(input.scaleLabels)) q.scaleLabels = input.scaleLabels.map((s) => String(s));
  }

  if (input.type === 'file') {
    q.accept = input.accept != null ? String(input.accept) : '*/*';
    q.multiple = input.multiple === true;
    q.maxFiles = Number.isFinite(input.maxFiles) ? input.maxFiles : q.multiple ? 5 : 1;
  }

  return q;
}

export function normalizeSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError('Spec must be a JSON object.');
  }

  let categories;
  if (Array.isArray(input.categories)) {
    categories = input.categories;
  } else if (Array.isArray(input.questions)) {
    categories = [{ id: 'default', title: input.title || 'Questions', questions: input.questions }];
  } else {
    throw new SpecError('Spec must contain a "categories" array or a flat "questions" array.');
  }
  if (categories.length === 0) throw new SpecError('Spec has no categories.');

  const rawSettings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const settings = {
    pageSize: Number.isFinite(rawSettings.pageSize) ? Math.max(1, Math.floor(rawSettings.pageSize)) : 5,
    theme: rawSettings.theme === 'light' || rawSettings.theme === 'dark' ? rawSettings.theme : 'auto',
    submitLabel: rawSettings.submitLabel != null ? String(rawSettings.submitLabel) : 'Submit',
  };

  const seen = new Set();
  let counter = 0;
  const outCategories = categories.map((cat, ci) => {
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) {
      throw new SpecError(`categories[${ci}] must be an object.`);
    }
    if (!Array.isArray(cat.questions) || cat.questions.length === 0) {
      throw new SpecError(`Category "${cat.title || ci}" must have a non-empty "questions" array.`);
    }
    const questions = cat.questions.map((q, qi) =>
      normalizeQuestion(q, `categories[${ci}].questions[${qi}]`, seen, ++counter),
    );
    const out = {
      id: String(cat.id || slug(cat.title, `cat${ci + 1}`)),
      title: String(cat.title || `Section ${ci + 1}`),
      questions,
    };
    if (cat.description != null) out.description = String(cat.description);
    return out;
  });

  return {
    version: 1,
    title: input.title != null ? String(input.title) : 'Brainstorm',
    ...(input.intro != null ? { intro: String(input.intro) } : {}),
    settings,
    categories: outCategories,
  };
}

export function allQuestions(spec) {
  return spec.categories.flatMap((c) => c.questions);
}

export const SPEC_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Brainstormform questions',
  type: 'object',
  properties: {
    version: { const: 1 },
    title: { type: 'string' },
    intro: { type: 'string' },
    settings: {
      type: 'object',
      properties: {
        pageSize: { type: 'integer', minimum: 1, default: 5 },
        theme: { enum: ['auto', 'light', 'dark'], default: 'auto' },
        submitLabel: { type: 'string', default: 'Submit' },
      },
      additionalProperties: false,
    },
    categories: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['title', 'questions'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          questions: { type: 'array', minItems: 1, items: { $ref: '#/definitions/question' } },
        },
      },
    },
  },
  definitions: {
    question: {
      type: 'object',
      required: ['type', 'label'],
      properties: {
        id: { type: 'string' },
        type: { enum: QUESTION_TYPES },
        label: { type: 'string' },
        help: { type: 'string' },
        required: { type: 'boolean', default: false },
        placeholder: { type: 'string' },
        default: {},
        options: {
          type: 'array',
          items: {
            type: 'object',
            required: ['value'],
            properties: { value: {}, label: { type: 'string' }, description: { type: 'string' } },
          },
        },
        allowOther: { type: 'boolean' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
        scaleLabels: { type: 'array', items: { type: 'string' } },
        accept: { type: 'string' },
        multiple: { type: 'boolean' },
        maxFiles: { type: 'integer' },
      },
    },
  },
};

const EXAMPLE = {
  title: 'Project kickoff brainstorm',
  intro: 'A few questions to nail down scope. You can skip anything optional.',
  settings: { pageSize: 4 },
  categories: [
    {
      title: 'Scope',
      questions: [
        {
          id: 'goal',
          type: 'textarea',
          label: 'What is the primary goal?',
          help: 'One or two sentences.',
          required: true,
        },
        {
          id: 'platforms',
          type: 'multi',
          label: 'Which platforms must we support?',
          options: [
            { value: 'web', label: 'Web' },
            { value: 'ios', label: 'iOS' },
            { value: 'android', label: 'Android' },
          ],
          allowOther: true,
        },
        {
          id: 'urgency',
          type: 'scale',
          label: 'How urgent is this?',
          min: 1,
          max: 5,
          scaleLabels: ['Whenever', 'Very urgent'],
        },
      ],
    },
    {
      title: 'Design',
      questions: [
        {
          id: 'mood',
          type: 'single',
          label: 'Pick a visual direction',
          options: [
            { value: 'minimal', label: 'Minimal', description: 'Whitespace, few colors' },
            { value: 'bold', label: 'Bold', description: 'Strong colors and type' },
          ],
          allowOther: true,
        },
        { id: 'references', type: 'file', label: 'Upload any reference images', multiple: true, accept: 'image/*' },
      ],
    },
  ],
};

export function schemaText() {
  return JSON.stringify(SPEC_SCHEMA, null, 2);
}

export function guideText() {
  return `# Brainstormform

Ask a user unlimited brainstorming questions through a local web form.

## How to use it

1. Write a questions spec (JSON, see below) to a file.
2. Run:  brainstormform ask questions.json --open
   It prints a JSON line: {"sessionId":"...","url":"http://127.0.0.1:PORT/s/TOKEN","pid":...}
3. Tell the user to open the url (it opens automatically with --open) and submit.
4. Fetch the answers:  brainstormform wait <sessionId> --timeout 600
   - stdout is the answers JSON (or exit code 3 on timeout: just call wait again)
   - session data is deleted as soon as you read it, unless you pass --keep

Prefer the MCP tools if your client supports MCP:
- ask_questions({ title, categories | questions, open, waitSeconds }) -> { sessionId, url }
- get_answers({ sessionId, timeoutSeconds }) -> answers

## Spec format

Top level:
- title (string), intro (string, optional)
- settings: { pageSize (default 5), theme: "auto"|"light"|"dark", submitLabel }
- categories: [ { title, description?, questions: [ ... ] } ]
  (a flat top-level "questions": [...] array is also accepted)

Question:
- type: one of ${QUESTION_TYPES.join(', ')}
- label (string, required), id (string, auto q1..qN), help?, required? (default false)
- single/multi: options: [{ value, label?, description? }], allowOther? (reveals a free-text box)
- number/scale: min, max, step?, scaleLabels? (scale defaults 1..5)
- file: accept? ("image/*,.pdf"), multiple? (default false), maxFiles?
- text/textarea: placeholder?

## Example

${JSON.stringify(EXAMPLE, null, 2)}

## Answers output

{
  "sessionId": "...", "submittedAt": "ISO", "durationMs": 12345,
  "answers": {
    "goal":     { "type": "textarea", "value": "Ship v1" },
    "platforms":{ "type": "multi", "value": ["web","ios"], "other": "desktop" },
    "urgency":  { "type": "scale", "value": 4 },
    "mood":     { "type": "single", "value": "minimal", "other": null },
    "references": { "type": "file", "value": [{ "name":"x.png", "path":"/abs/path", "size":123, "mime":"image/png" }] }
  },
  "unanswered": ["..."]
}

Files are stored under the session dir and referenced by absolute path. Use --keep to
copy the session (with uploads) to ./brainstormform-<id>/ before it is cleaned up.
`;
}

export function exampleSpec() {
  return JSON.parse(JSON.stringify(EXAMPLE));
}
