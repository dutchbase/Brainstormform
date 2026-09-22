import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMarkdown, evaluateShowIf, escapeHtml, allQuestions, compactAnswers, summaryMarkdown, formatAnswers } from '../src/render.mjs';

test('escapeHtml neutralises tags', () => {
  assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
});

test('renderInlineMarkdown supports bold, code and safe links', () => {
  const html = renderInlineMarkdown('**bold** `code` [site](https://example.com)');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">site<\/a>/);
});

test('renderMarkdown refuses javascript: urls and raw html', () => {
  const html = renderMarkdown('[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img/);
});

test('renderMarkdown renders headings and lists', () => {
  const html = renderMarkdown('# Title\n\n- one\n- two');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test('evaluateShowIf covers the operators', () => {
  const answers = { a: 'web', b: ['ios', 'web'], c: true, d: '' };
  assert.equal(evaluateShowIf({ question: 'a', op: 'equals', value: 'web' }, answers), true);
  assert.equal(evaluateShowIf({ question: 'a', op: 'not_equals', value: 'web' }, answers), false);
  assert.equal(evaluateShowIf({ question: 'b', op: 'contains', value: 'ios' }, answers), true);
  assert.equal(evaluateShowIf({ question: 'b', op: 'in', value: ['android'] }, answers), false);
  assert.equal(evaluateShowIf({ question: 'd', op: 'answered', value: false }, answers), true);
  assert.equal(evaluateShowIf(undefined, answers), true);
});

const SPEC = {
  title: 'T',
  categories: [
    {
      title: 'Scope',
      questions: [
        { id: 'a', type: 'text', label: 'Goal' },
        { id: 'b', type: 'multi', label: 'Platforms' },
      ],
    },
  ],
};

test('allQuestions flattens categories', () => {
  assert.deepEqual(allQuestions(SPEC).map((q) => q.id), ['a', 'b']);
});

test('compactAnswers drops type wrappers, empties and always-empty arrays', () => {
  const out = compactAnswers({
    answers: { a: { type: 'text', value: 'ship v1' }, b: { type: 'multi', value: [] }, c: { type: 'text', value: '' } },
    other: { b: 'desktop' },
    notes: { a: 'soon' },
  });
  assert.deepEqual(out, { answers: { a: 'ship v1', b: 'desktop' }, notes: { a: 'soon' } });
});

test('compactAnswers passes through raw progress values', () => {
  assert.deepEqual(compactAnswers({ answers: { a: 'draft', b: ['x'] }, other: {}, notes: {} }), {
    answers: { a: 'draft', b: ['x'] },
  });
});

test('summaryMarkdown renders categories, values and notes', () => {
  const md = summaryMarkdown(SPEC, {
    answers: { a: { type: 'text', value: 'ship v1' }, b: { type: 'multi', value: ['web', 'ios'] } },
    notes: { a: 'but small' },
  });
  assert.match(md, /## Scope/);
  assert.match(md, /\*\*Goal\*\*\nship v1/);
  assert.match(md, /_Note: but small_/);
  assert.match(md, /- web/);
});

test('formatAnswers selects the shape', () => {
  const rec = { answers: { a: 1 }, other: {}, notes: {} };
  assert.equal(formatAnswers(SPEC, rec, 'full'), rec);
  assert.deepEqual(formatAnswers(SPEC, rec, 'json'), { answers: { a: 1 } });
  assert.match(formatAnswers(SPEC, rec, 'md'), /# T/);
});
