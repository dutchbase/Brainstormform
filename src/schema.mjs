import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

export class SpecError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpecError';
  }
}

export const QUESTION_TYPES = [
  'single',
  'multi',
  'visual',
  'text',
  'textarea',
  'number',
  'scale',
  'boolean',
  'file',
  'matrix',
  'rank',
];
const TYPES = new Set(QUESTION_TYPES);
const CHOICE_TYPES = new Set(['single', 'multi', 'visual']);

function normalizeOptions(input, where) {
  return input.options.map((opt, i) => {
    const value = opt && typeof opt === 'object' ? opt.value : opt;
    const text = opt && typeof opt === 'object' ? opt.label ?? opt.value : opt;
    if (value == null) throw new SpecError(`${where}.options[${i}] needs a "value".`);
    const out = { value: String(value), label: String(text) };
    if (opt && typeof opt === 'object' && opt.description != null) out.description = String(opt.description);
    if (input.type === 'visual') {
      const image = opt && typeof opt === 'object' ? opt.image : undefined;
      if (image == null) throw new SpecError(`${where}.options[${i}].image is required for type "visual".`);
      out.image = String(image);
    }
    return out;
  });
}

function normalizeAxis(list, where, name) {
  return list.map((item, i) => {
    const value = item && typeof item === 'object' ? item.value : item;
    const label = item && typeof item === 'object' ? item.label ?? item.value : item;
    if (value == null) throw new SpecError(`${where}.${name}[${i}] needs a "value".`);
    return { value: String(value), label: String(label) };
  });
}

function slug(value, fallback) {
  const out = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}

function normalizeShowIf(input, where, earlierIds) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError(`${where}.showIf must be an object.`);
  }
  const question = input.question == null ? '' : String(input.question);
  if (!question) throw new SpecError(`${where}.showIf.question is required.`);
  if (!earlierIds.has(question)) {
    throw new SpecError(`${where}.showIf references "${question}", which must appear earlier in the form.`);
  }
  if ('equals' in input) return { question, op: 'equals', value: input.equals };
  if ('not' in input) return { question, op: 'not_equals', value: input.not };
  if ('contains' in input) return { question, op: 'contains', value: input.contains };
  if ('in' in input) {
    if (!Array.isArray(input.in)) throw new SpecError(`${where}.showIf.in must be an array.`);
    return { question, op: 'in', value: input.in };
  }
  if ('answered' in input) return { question, op: 'answered', value: input.answered !== false };
  throw new SpecError(`${where}.showIf needs one of: equals, not, in, contains, answered.`);
}

function normalizeQuestion(input, where, state) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError(`${where} must be an object.`);
  }
  if (!TYPES.has(input.type)) {
    throw new SpecError(`${where}.type "${input.type}" is invalid. Allowed: ${QUESTION_TYPES.join(', ')}.`);
  }

  const id = input.id == null ? `q${++state.count}` : String(input.id);
  if (state.seen.has(id)) throw new SpecError(`Duplicate question id "${id}".`);

  const label = input.label == null ? String(input.title || '') : String(input.label);
  if (!label) throw new SpecError(`${where}.label is required.`);

  const q = { id, type: input.type, label, required: input.required === true };
  if (input.showIf !== undefined) q.showIf = normalizeShowIf(input.showIf, where, state.seen);
  if (input.then !== undefined) {
    const t = input.then;
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new SpecError(`${where}.then must be an object.`);
    if (!Array.isArray(t.add) || t.add.length === 0) throw new SpecError(`${where}.then.add must be a non-empty array of questions.`);
    const cond = normalizeShowIf(t, `${where}.then`, new Set([...state.seen, id]));
    q.then = { question: cond.question, op: cond.op, value: cond.value, add: t.add };
  }
  const intro = input.intro !== undefined ? input.intro : input.help;
  if (intro != null) q.intro = String(intro);
  if (input.content != null) q.content = String(input.content);
  if (input.placeholder != null) q.placeholder = String(input.placeholder);
  if (input.default !== undefined) q.default = input.default;

  if (CHOICE_TYPES.has(input.type)) {
    if (!Array.isArray(input.options) || input.options.length === 0) {
      throw new SpecError(`${where}.options must be a non-empty array for type "${input.type}".`);
    }
    q.options = normalizeOptions(input, where);
    q.allowOther = (input.type === 'single' || input.type === 'multi') && input.allowOther === true;
    if (input.type === 'visual') q.multiple = input.multiple === true;
  }

  if (input.type === 'rank') {
    if (!Array.isArray(input.options) || input.options.length < 2) {
      throw new SpecError(`${where}.options must have at least two entries for type "rank".`);
    }
    q.options = normalizeOptions(input, where);
  }

  if (input.type === 'matrix') {
    if (!Array.isArray(input.rows) || input.rows.length === 0) {
      throw new SpecError(`${where}.rows must be a non-empty array.`);
    }
    if (!Array.isArray(input.columns) || input.columns.length === 0) {
      throw new SpecError(`${where}.columns must be a non-empty array.`);
    }
    q.rows = normalizeAxis(input.rows, where, 'rows');
    q.columns = normalizeAxis(input.columns, where, 'columns');
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
    if (input.step !== undefined) {
      const step = Number(input.step);
      if (!Number.isFinite(step) || step <= 0) {
        throw new SpecError(`${where}.step must be a positive number.`);
      }
      q.step = step;
    } else {
      q.step = 1;
    }
    if (Array.isArray(input.scaleLabels)) q.scaleLabels = input.scaleLabels.map((s) => String(s));
  }

  if (input.type === 'file') {
    q.accept = input.accept != null ? String(input.accept) : '*/*';
    q.multiple = input.multiple === true;
    q.maxFiles = Number.isFinite(input.maxFiles) ? Math.max(1, Math.floor(input.maxFiles)) : q.multiple ? 5 : 1;
  }

  state.seen.add(id);
  return q;
}

function normalizeCategory(input, where, state, { requireTitle }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecError(`${where} must be an object.`);
  }
  if (requireTitle && !input.title) throw new SpecError(`${where}.title is required.`);
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new SpecError(`${where} must have a non-empty "questions" array.`);
  }
  const questions = input.questions.map((q, qi) => normalizeQuestion(q, `${where}.questions[${qi}]`, state));
  const out = {
    id: String(input.id || slug(input.title, `${where.replace(/[^\w]+/g, '-')}-${state.categoryCount}`)),
    title: String(input.title || `Section ${++state.categoryCount}`),
    questions,
  };
  const intro = input.intro !== undefined ? input.intro : input.description;
  if (intro != null) out.intro = String(intro);
  return out;
}

function categoryBaseId(input, index) {
  return String((input && input.id) || slug(input && input.title, `cat${index + 1}`));
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
    submitLabel: rawSettings.submitLabel != null ? String(rawSettings.submitLabel) : 'Continue',
    finishLabel: rawSettings.finishLabel != null ? String(rawSettings.finishLabel) : 'Finish',
  };

  const state = { seen: new Set(), count: 0, categoryCount: 0 };
  const categoryIds = new Set();
  const outCategories = categories.map((cat, ci) => {
    const where = `categories[${ci}]`;
    const out = normalizeCategory(cat, where, state, { requireTitle: true });
    if (categoryIds.has(out.id)) out.id = `${out.id}-${ci + 1}`;
    categoryIds.add(out.id);
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

export function normalizeFragment(spec, fragment) {
  let rawCategories;
  if (Array.isArray(fragment)) {
    rawCategories = [{ title: 'Follow-up questions', questions: fragment }];
  } else if (fragment && Array.isArray(fragment.categories)) {
    rawCategories = fragment.categories;
  } else if (fragment && Array.isArray(fragment.questions)) {
    rawCategories = [{ title: fragment.title || 'Follow-up questions', questions: fragment.questions }];
  } else {
    throw new SpecError('Fragment must be an array of questions or an object with "categories" or "questions".');
  }
  if (rawCategories.length === 0) throw new SpecError('Fragment has no questions.');

  const state = {
    seen: collectIds(spec),
    count: allQuestions(spec).length,
    categoryCount: spec.categories.length,
  };
  const categoryIds = new Set(spec.categories.map((c) => c.id));

  return rawCategories.map((cat, ci) => {
    const where = `fragment.categories[${ci}]`;
    const out = normalizeCategory(cat, where, state, { requireTitle: ci === 0 ? false : true });
    if (categoryIds.has(out.id)) out.id = `${out.id}-${Date.now().toString(36)}`;
    categoryIds.add(out.id);
    return out;
  });
}

export function appendFragment(spec, fragment) {
  const categories = normalizeFragment(spec, fragment);
  return { ...spec, categories: [...spec.categories, ...categories] };
}

export function collectIds(spec) {
  const ids = new Set();
  for (const cat of spec.categories) for (const q of cat.questions) ids.add(q.id);
  return ids;
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
        submitLabel: { type: 'string' },
        finishLabel: { type: 'string' },
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
          intro: { type: 'string', description: 'Markdown, shown under the heading' },
          description: { type: 'string', description: 'Alias for intro' },
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
        intro: { type: 'string', description: 'Markdown help text' },
        content: { type: 'string', description: 'Markdown block rendered under the heading' },
        required: { type: 'boolean', default: false },
        placeholder: { type: 'string' },
        default: {},
        showIf: {
          type: 'object',
          description: 'Show only when an earlier answer matches',
          properties: {
            question: { type: 'string' },
            equals: {},
            not: {},
            in: { type: 'array' },
            contains: {},
            answered: { type: 'boolean' },
          },
          required: ['question'],
        },
        then: {
          type: 'object',
          description: 'Append follow-up questions when an earlier answer matches',
          properties: {
            question: { type: 'string' },
            equals: {},
            not: {},
            in: { type: 'array' },
            contains: {},
            answered: { type: 'boolean' },
            add: { type: 'array', items: { $ref: '#/definitions/question' } },
          },
          required: ['question', 'add'],
        },
        options: {
          type: 'array',
          items: {
            type: 'object',
            required: ['value'],
            properties: {
              value: {},
              label: { type: 'string' },
              description: { type: 'string' },
              image: { type: 'string', description: 'visual only: https URL or local file path' },
            },
          },
        },
        allowOther: { type: 'boolean' },
        multiple: { type: 'boolean' },
        rows: { type: 'array', description: 'matrix only: row axis [{ value, label }]' },
        columns: { type: 'array', description: 'matrix only: column axis [{ value, label }]' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
        scaleLabels: { type: 'array', items: { type: 'string' } },
        accept: { type: 'string' },
        maxFiles: { type: 'integer' },
      },
    },
  },
};

const EXAMPLE = {
  title: 'Project kickoff brainstorm',
  intro: 'A few questions to nail down scope. The form saves as you type.',
  settings: { pageSize: 4 },
  categories: [
    {
      title: 'Scope',
      intro: 'What are we actually building, and how big is it?',
      questions: [
        {
          id: 'goal',
          type: 'textarea',
          label: 'What is the primary goal?',
          intro: 'One or two sentences is plenty.',
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
          id: 'appstore',
          type: 'text',
          label: 'Which app store account should we ship under?',
          showIf: { question: 'platforms', contains: 'ios' },
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
          type: 'visual',
          label: 'Pick a visual direction',
          options: [
            { value: 'minimal', label: 'Minimal', image: 'https://placehold.co/320x200?text=Minimal' },
            { value: 'bold', label: 'Bold', image: 'https://placehold.co/320x200?text=Bold' },
          ],
        },
        {
          id: 'notes',
          type: 'textarea',
          label: 'Anything else?',
          intro: 'Links are welcome, e.g. [our brand guide](https://example.com).',
        },
      ],
    },
  ],
};

export function schemaText() {
  return JSON.stringify(SPEC_SCHEMA, null, 2);
}

export function guideText() {
  return `# Brainstormform — question format

Ask a user unlimited questions through a local web form, live.

## Commands

  brainstormform ask questions.json --open        # start a form, prints {sessionId,url}
  brainstormform progress <id>                    # current draft answers + status
  brainstormform add <id> more-questions.json     # append questions to a live form
  brainstormform wait <id> --timeout 600          # block until the user presses Finish

MCP tools: ask_questions, read_answers, add_questions, wait_for_answers.

## Spec format

Top level: title, intro (Markdown), settings { pageSize, theme, submitLabel, finishLabel },
and either categories: [{ title, intro?, questions: [...] }] or a flat questions: [...].

Question:
- type: one of ${QUESTION_TYPES.join(', ')}
- label (required), id (auto q1..qN), required?
- intro (Markdown, short help), content (Markdown block)
- showIf: { question, equals | not | in | contains | answered } to show conditionally
- single/multi: options [{ value, label?, description? }], allowOther?
- visual: options [{ value, label?, description?, image }] where image is https URL or local path
- number/scale: min, max, step?, scaleLabels?
- file: accept?, multiple?, maxFiles?
- text/textarea: placeholder?

Every question also accepts a free-text **note** from the user, returned in
"notes" keyed by question id. Encourage the user to add one when none of the
options quite fits or they want to qualify an answer.

"add" appends new questions to a running form. Existing questions cannot be changed.

## Example

${JSON.stringify(EXAMPLE, null, 2)}

## Answers output

{
  "sessionId": "...", "submittedAt": "ISO", "durationMs": 12345,
  "answers": {
    "goal":      { "type": "textarea", "value": "Ship v1" },
    "platforms": { "type": "multi", "value": ["web","ios"], "other": "desktop" },
    "urgency":   { "type": "scale", "value": 4 }
  },
  "notes": { "urgency": "urgent, but not at the cost of quality" },
  "skipped": ["notes"],
  "unanswered": [],
  "hidden": ["appstore"]
}
`;
}

export function exampleSpec() {
  return JSON.parse(JSON.stringify(EXAMPLE));
}

export function seedDefaults(spec, answers) {
  const byId = new Map();
  for (const [id, entry] of Object.entries(answers || {})) {
    const value = entry && typeof entry === 'object' && !Array.isArray(entry) && 'type' in entry ? entry.value : entry;
    if (value !== undefined && value !== null && value !== '') byId.set(id, value);
  }
  const out = JSON.parse(JSON.stringify(spec));
  for (const q of out.categories.flatMap((c) => c.questions)) if (byId.has(q.id)) q.default = byId.get(q.id);
  return out;
}
