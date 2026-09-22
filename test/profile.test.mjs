import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProfile, profileSummary, profileFromAnswers, normalizeSpec, PROFILE_QUESTION_IDS, SpecError } from '../src/schema.mjs';

test('normalizeProfile trims strings and validates enums', () => {
  const p = normalizeProfile({ name: '  Ada  ', experience: 'learning', languageLevel: 'plain', detail: 'detailed', examples: true });
  assert.equal(p.version, 1);
  assert.equal(p.name, 'Ada');
  assert.equal(p.experience, 'learning');
  assert.equal(p.examples, true);
  assert.ok(p.updatedAt);
});

test('normalizeProfile rejects a bad level and non-boolean examples', () => {
  assert.throws(() => normalizeProfile({ experience: 'wizard' }), SpecError);
  assert.throws(() => normalizeProfile({ examples: 'yes' }), SpecError);
});

test('normalizeProfile drops unknown fields and empty strings', () => {
  const p = normalizeProfile({ name: '', role: 'indie hacker', hacker: true });
  assert.equal(p.name, undefined);
  assert.equal(p.role, 'indie hacker');
  assert.equal(p.hacker, undefined);
});

test('profileSummary is small when unconfigured and descriptive when set', () => {
  assert.deepEqual(profileSummary(null), { configured: false });
  const s = profileSummary({ experience: 'learning', languageLevel: 'plain', detail: 'detailed', examples: true });
  assert.equal(s.configured, true);
  assert.match(s.summary, /learning/);
  assert.match(s.summary, /plain/);
});

test('profileFromAnswers maps rendered answers into a profile', () => {
  const p = profileFromAnswers({
    answers: {
      name: { type: 'text', value: 'Ada' },
      experience: { type: 'single', value: 'senior' },
      examples: { type: 'boolean', value: false },
    },
  });
  assert.equal(p.name, 'Ada');
  assert.equal(p.experience, 'senior');
  assert.equal(p.examples, false);
});

test('the profile preset covers every profile question id', async () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'profile.json');
  const spec = normalizeSpec(JSON.parse(await fsp.readFile(file, 'utf8')));
  const ids = spec.categories.flatMap((c) => c.questions).map((q) => q.id);
  for (const id of PROFILE_QUESTION_IDS) assert.ok(ids.includes(id), 'preset is missing ' + id);
});
