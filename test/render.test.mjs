import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMarkdown, evaluateShowIf, escapeHtml } from '../src/render.mjs';

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
