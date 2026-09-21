import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.mjs';

test('boolean flags never consume the next positional', () => {
  assert.deepEqual(parseArgs(['--open', 'q.json']), { _: ['q.json'], open: true });
  assert.deepEqual(parseArgs(['--keep', 'q.json']), { _: ['q.json'], keep: true });
  assert.deepEqual(parseArgs(['q.json', '--json']), { _: ['q.json'], json: true });
});

test('value flags read the next token and inline = values', () => {
  assert.deepEqual(parseArgs(['--timeout', '10', 'q']), { _: ['q'], timeout: '10' });
  assert.deepEqual(parseArgs(['--target=a,b']), { _: [], target: 'a,b' });
  assert.equal(parseArgs(['--on-submit=echo a=b'])['on-submit'], 'echo a=b');
});

test('a trailing value flag becomes boolean, -- ends flag parsing', () => {
  assert.deepEqual(parseArgs(['--out']), { _: [], out: true });
  assert.deepEqual(parseArgs(['--', '--not-a-flag']), { _: ['--not-a-flag'] });
});
