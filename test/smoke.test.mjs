import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { normalizeSpec, normalizeFragment, SpecError, seedDefaults } from '../src/schema.mjs';
import { startServer } from '../src/server.mjs';
import { handle as mcpHandle } from '../src/mcp.mjs';
import { createSession, waitForAnswers, stopSession, sessionDir, exportSession, assertSafeDest, profilePath, readProfile, writeProfile, clearProfile } from '../src/session.mjs';

test('normalizeSpec wraps flat questions and applies defaults', () => {
  const spec = normalizeSpec({ title: 'Hi', questions: [{ id: 'a', type: 'text', label: 'A' }] });
  assert.equal(spec.categories.length, 1);
  assert.equal(spec.categories[0].questions[0].id, 'a');
  assert.equal(spec.settings.pageSize, 5);
  assert.equal(spec.categories[0].questions[0].required, false);
});

test('normalizeSpec rejects bad types, duplicate ids and forward showIf refs', () => {
  assert.throws(() => normalizeSpec({ questions: [{ type: 'wat', label: 'x' }] }), SpecError);
  assert.throws(
    () => normalizeSpec({ questions: [{ id: 'x', type: 'text', label: 'a' }, { id: 'x', type: 'text', label: 'b' }] }),
    SpecError,
  );
  assert.throws(
    () => normalizeSpec({ questions: [{ type: 'text', label: 'a', showIf: { question: 'later', equals: 1 } }, { id: 'later', type: 'text', label: 'b' }] }),
    SpecError,
  );
});

test('visual type requires an image per option', () => {
  assert.throws(() => normalizeSpec({ questions: [{ type: 'visual', label: 'v', options: [{ value: 'a' }] }] }), SpecError);
  const spec = normalizeSpec({ questions: [{ type: 'visual', label: 'v', options: [{ value: 'a', image: 'https://x/y.png' }] }] });
  assert.equal(spec.categories[0].questions[0].options[0].image, 'https://x/y.png');
});

test('normalizeFragment appends and validates against the existing spec', () => {
  const spec = normalizeSpec({ questions: [{ id: 'goal', type: 'text', label: 'Goal' }] });
  assert.throws(() => normalizeFragment(spec, [{ id: 'goal', type: 'text', label: 'dup' }]), SpecError);
  const added = normalizeFragment(spec, [{ type: 'text', label: 'Follow up', showIf: { question: 'goal', answered: true } }]);
  assert.equal(added.length, 1);
  assert.equal(added[0].questions[0].showIf.question, 'goal');
});

test('end-to-end: live progress, append, submit, host guard, assets', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-test-'));
  const spec = normalizeSpec({
    title: 'T',
    questions: [
      { id: 'a', type: 'text', label: 'A', required: true },
      { id: 'f', type: 'file', label: 'F' },
    ],
  });
  const token = 'tok'.repeat(10);
  const srv = await startServer({ sessionDir: dir, spec, token, maxUpload: 4 });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;

  try {
    const ui = await fetch(base);
    assert.equal(ui.status, 200);
    const html = await ui.text();
    assert.match(html, /Brainstormform/);
    assert.match(html, /data-bf-base=/);
    assert.match(html, /app\/ui\.js/);

    const uiJs = await fetch(`${base}/app/ui.js`);
    assert.equal(uiJs.status, 200);
    assert.match(uiJs.headers.get('content-type'), /javascript/);
    assert.match(await uiJs.text(), /documentElement\.dataset\.bfBase/);

    const questions = await fetch(`${base}/api/questions`);
    const qbody = await questions.json();
    assert.equal(qbody.spec.title, 'T');
    assert.equal(qbody.status, 'open');

    const saved = await fetch(`${base}/api/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { a: 'draft' }, other: {}, skipped: [] }),
    });
    assert.equal(saved.status, 200);
    const progress = JSON.parse(await fsp.readFile(path.join(dir, 'progress.json'), 'utf8'));
    assert.equal(progress.answers.a, 'draft');

    const appended = await fetch(`${base}/api/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ type: 'text', label: 'Follow up' }]),
    });
    assert.equal(appended.status, 200);
    assert.equal((await appended.json()).revision, 2);
    const onDisk = JSON.parse(await fsp.readFile(path.join(dir, 'questions.json'), 'utf8'));
    assert.equal(onDisk.categories.length, 2);

    const up = await fetch(`${base}/api/upload?name=pic.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
    });
    assert.equal(up.status, 200);
    const info = await up.json();
    assert.ok(info.path.startsWith(dir));

    const tooBig = await fetch(`${base}/api/upload?name=big.bin`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    assert.equal(tooBig.status, 413);

    const wrongToken = await fetch(`http://127.0.0.1:${srv.port}/s/nope/api/questions`);
    assert.equal(wrongToken.status, 404);

    const guard = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: srv.port, path: `/s/${token}`, headers: { host: 'evil.example' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(guard, 403);

    const submit = await fetch(`${base}/api/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { a: { type: 'text', value: 'hi' } }, skipped: ['f'], unanswered: [], hidden: [] }),
    });
    assert.equal(submit.status, 200);
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'answers.json'), 'utf8'));
    assert.equal(record.answers.a.value, 'hi');
    assert.deepEqual(record.skipped, ['f']);
    assert.equal(record.sessionId, path.basename(dir));

    const afterSubmit = await fetch(`${base}/api/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ type: 'text', label: 'Too late' }]),
    });
    assert.equal(afterSubmit.status, 409);
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('server rewrites local visual images to a safe asset route', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-asset-'));
  const prev = process.cwd();
  process.chdir(dir);
  await fsp.writeFile(path.join(dir, 'ref.png'), Buffer.from([137, 80, 78, 71]));
  const spec = normalizeSpec({
    questions: [{ id: 'v', type: 'visual', label: 'Pick', options: [{ value: 'a', image: 'ref.png' }] }],
  });
  const token = 'asset-token';
  const srv = await startServer({ sessionDir: path.join(dir, 'session'), spec, token });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    const body = await (await fetch(`${base}/api/questions`)).json();
    assert.equal(body.spec.categories[0].questions[0].options[0].image, `/s/${token}/api/asset/0`);
    const asset = await fetch(`${base}/api/asset/0`);
    assert.equal(asset.status, 200);
    const missing = await fetch(`${base}/api/asset/9`);
    assert.equal(missing.status, 404);
  } finally {
    process.chdir(prev);
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('local images outside the working directory are not served', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-outside-'));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-secret-'));
  await fsp.writeFile(path.join(outside, 'secret.png'), Buffer.from([137, 80, 78, 71]));
  const spec = normalizeSpec({
    questions: [{ id: 'v', type: 'visual', label: 'Pick', options: [{ value: 'a', image: path.join(outside, 'secret.png') }] }],
  });
  const srv = await startServer({ sessionDir: path.join(dir, 'session'), spec, token: 'asset-token' });
  try {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/s/asset-token/api/questions`)).json();
    assert.equal(body.spec.categories[0].questions[0].options[0].image, path.join(outside, 'secret.png'));
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test('server rewrites local images embedded in explanations and intros', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-mdexp-'));
  const prev = process.cwd();
  process.chdir(dir);
  await fsp.writeFile(path.join(dir, 'mock.png'), Buffer.from([137, 80, 78, 71]));
  await fsp.writeFile(path.join(dir, 'notes.txt'), 'nope');
  const spec = normalizeSpec({
    categories: [
      {
        title: 'C',
        intro: 'See ![cat](mock.png)',
        questions: [
          { id: 'q', type: 'text', label: 'Q', explanation: 'Ref ![shot](mock.png) and ![bad](notes.txt) and ![web](https://x/y.png)' },
        ],
      },
    ],
  });
  const token = 'mdexp-token';
  const srv = await startServer({ sessionDir: path.join(dir, 'session'), spec, token });
  try {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/s/${token}/api/questions`)).json();
    const cat = body.spec.categories[0];
    assert.match(cat.intro, /!\[cat\]\(\/s\/mdexp-token\/api\/asset\/0\)/);
    assert.match(cat.questions[0].explanation, /!\[shot\]\(\/s\/mdexp-token\/api\/asset\/1\)/);
    assert.match(cat.questions[0].explanation, /!\[web\]\(https:\/\/x\/y\.png\)/);
    assert.match(cat.questions[0].explanation, /!\[bad\]\(notes\.txt\)/, 'non-image extension is left alone');
    const asset = await fetch(`http://127.0.0.1:${srv.port}/s/${token}/api/asset/0`);
    assert.equal(asset.status, 200);
  } finally {
    process.chdir(prev);
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('server does not rewrite a local explanation image outside the working directory', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-mdout-'));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-mdsecret-'));
  await fsp.writeFile(path.join(outside, 'secret.png'), Buffer.from([137, 80, 78, 71]));
  const spec = normalizeSpec({ questions: [{ id: 'q', type: 'text', label: 'Q', explanation: '![s](' + path.join(outside, 'secret.png') + ')' }] });
  const srv = await startServer({ sessionDir: path.join(dir, 'session'), spec, token: 'mdout-token' });
  try {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/s/mdout-token/api/questions`)).json();
    assert.equal(body.spec.categories[0].questions[0].explanation, '![s](' + path.join(outside, 'secret.png') + ')');
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test('mcp: initialize, tools/list, resources, ping and errors', async () => {
  const init = await mcpHandle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'brainstormform');
  assert.ok(init.result.capabilities.resources);

  const list = await mcpHandle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['ask_questions', 'read_answers', 'add_questions', 'wait_for_answers', 'get_profile'],
  );

  assert.deepEqual(
    (await mcpHandle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).result.resources.map((r) => r.uri),
    ['brainstormform://guide', 'brainstormform://profile'],
  );
  const guide = await mcpHandle({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'brainstormform://guide' } });
  assert.match(guide.result.contents[0].text, /question format/i);
  const profRes = await mcpHandle({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'brainstormform://profile' } });
  assert.equal(typeof profRes.result.contents[0].text, 'string');
  const profTool = await mcpHandle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_profile', arguments: {} } });
  assert.match(profTool.result.content[0].text, /configured/);
  assert.deepEqual((await mcpHandle({ jsonrpc: '2.0', id: 4, method: 'ping' })).result, {});
  assert.equal((await mcpHandle({ jsonrpc: '2.0', id: 5, method: 'nope' })).error.code, -32601);
  assert.equal(await mcpHandle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('scale step must be positive and maxFiles is clamped to at least one', () => {
  assert.throws(() => normalizeSpec({ questions: [{ type: 'scale', label: 's', step: 0 }] }), SpecError);
  assert.throws(() => normalizeSpec({ questions: [{ type: 'scale', label: 's', step: -1 }] }), SpecError);
  const ok = normalizeSpec({ questions: [{ type: 'scale', label: 's', step: 0.5 }] });
  assert.equal(ok.categories[0].questions[0].step, 0.5);
  const file = normalizeSpec({ questions: [{ type: 'file', label: 'f', multiple: true, maxFiles: 0 }] });
  assert.equal(file.categories[0].questions[0].maxFiles, 1);
});

test('sessionDir rejects ids that could escape the session root', () => {
  assert.throws(() => sessionDir('../../etc'));
  assert.throws(() => sessionDir('foo'));
  assert.throws(() => sessionDir('bf-..'));
  assert.ok(sessionDir('bf-abc-123').endsWith('bf-abc-123'));
});

test('waitForAnswers with timeout 0 returns immediately instead of blocking', async () => {
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }] });
  const { id } = await createSession(spec, {});
  try {
    const start = Date.now();
    const res = await waitForAnswers(id, { timeoutMs: 0 });
    assert.equal(res.error, 'timeout');
    assert.ok(Date.now() - start < 2000, 'should not block');
  } finally {
    await stopSession(id);
  }
});

test('progress and submit round-trip per-question notes', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-notes-'));
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'single', label: 'A', options: [{ value: 'x' }] }] });
  const token = 'note'.repeat(8);
  const srv = await startServer({ sessionDir: dir, spec, token });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    await fetch(`${base}/api/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { a: 'x' }, other: {}, notes: { a: 'close, but not quite' }, skipped: [] }),
    });
    const progress = JSON.parse(await fsp.readFile(path.join(dir, 'progress.json'), 'utf8'));
    assert.equal(progress.notes.a, 'close, but not quite');

    await fetch(`${base}/api/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { a: { type: 'single', value: 'x' } }, notes: { a: 'close, but not quite' }, skipped: [], unanswered: [], hidden: [] }),
    });
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'answers.json'), 'utf8'));
    assert.equal(record.notes.a, 'close, but not quite');
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the published package includes its docs and changelog', async () => {
  const pkg = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const entry of ['docs', 'skills', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
    assert.ok(pkg.files.includes(entry), 'package.json files should include ' + entry);
  }
});

test('the bundled brainstorming skill ships with its attribution', async () => {
  const dir = new URL('../skills/brainstorming/', import.meta.url);
  await fsp.access(new URL('SKILL.md', dir));
  const notice = await fsp.readFile(new URL('NOTICE', dir), 'utf8');
  assert.match(notice, /MIT License/);
});

test('profile IO round-trips and clears', async () => {
  const prev = process.env.XDG_CONFIG_HOME;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-profile-'));
  process.env.XDG_CONFIG_HOME = dir;
  try {
    assert.equal(await readProfile(), null);
    assert.ok(profilePath().startsWith(dir));
    await writeProfile({ version: 1, name: 'Ada', experience: 'learning' });
    assert.equal((await readProfile()).name, 'Ada');
    await clearProfile();
    assert.equal(await readProfile(), null);
  } finally {
    process.env.XDG_CONFIG_HOME = prev;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('profile API reads, writes and clears', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-profapi-'));
  const prev = process.env.XDG_CONFIG_HOME;
  const cfg = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-profcfg-'));
  process.env.XDG_CONFIG_HOME = cfg;
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }] });
  const token = 'prof'.repeat(8);
  const srv = await startServer({ sessionDir: dir, spec, token });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    assert.equal((await (await fetch(`${base}/api/profile`)).json()).profile, null);
    const saved = await fetch(`${base}/api/profile`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: { name: 'Ada', experience: 'learning' } }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await (await fetch(`${base}/api/profile`)).json()).profile.experience, 'learning');
    await fetch(`${base}/api/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clear: true }) });
    assert.equal((await (await fetch(`${base}/api/profile`)).json()).profile, null);
  } finally {
    process.env.XDG_CONFIG_HOME = prev;
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(cfg, { recursive: true, force: true });
  }
});

test('submit with saveProfile writes the global profile from the answers', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-profsave-'));
  const prev = process.env.XDG_CONFIG_HOME;
  const cfg = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-profsave-cfg-'));
  process.env.XDG_CONFIG_HOME = cfg;
  const spec = normalizeSpec({ questions: [{ id: 'experience', type: 'single', label: 'E', options: ['new', 'learning'] }] });
  const token = 'save'.repeat(8);
  const srv = await startServer({ sessionDir: dir, spec, token, saveProfile: true });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    await fetch(`${base}/api/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { experience: { type: 'single', value: 'learning' } }, skipped: [], unanswered: [], hidden: [] }),
    });
    assert.equal((await readProfile()).experience, 'learning');
  } finally {
    process.env.XDG_CONFIG_HOME = prev;
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(cfg, { recursive: true, force: true });
  }
});

test('createSession records saveProfile in meta', async () => {
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }] });
  const { id } = await createSession(spec, { saveProfile: true });
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(sessionDir(id), 'meta.json'), 'utf8'));
    assert.equal(meta.saveProfile, true);
  } finally {
    await stopSession(id);
  }
});

test('submit responds 200 before post-response work that throws', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-submit-ok-'));
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }] });
  const token = 'okok'.repeat(6);
  const srv = await startServer({ sessionDir: dir, spec, token, onSubmitted: () => { throw new Error('boom'); } });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    const res = await fetch(`${base}/api/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { a: { type: 'text', value: 'x' } }, skipped: [], unanswered: [], hidden: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'answers.json'), 'utf8'));
    assert.equal(record.answers.a.value, 'x');
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a bad profile form still submits and does not write a profile', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-badprof-'));
  const prev = process.env.XDG_CONFIG_HOME;
  const cfg = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-badprof-cfg-'));
  process.env.XDG_CONFIG_HOME = cfg;
  const spec = normalizeSpec({ questions: [{ id: 'experience', type: 'single', label: 'E', options: ['new', 'learning'] }] });
  const srv = await startServer({ sessionDir: dir, spec, token: 'badbad'.repeat(5), saveProfile: true });
  const base = `http://127.0.0.1:${srv.port}/s/${'badbad'.repeat(5)}`;
  try {
    const res = await fetch(`${base}/api/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { experience: { type: 'single', value: 'wizard' } }, skipped: [], unanswered: [], hidden: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(await readProfile(), null);
  } finally {
    process.env.XDG_CONFIG_HOME = prev;
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(cfg, { recursive: true, force: true });
  }
});

test('exportSession refuses to overwrite a non-empty directory unless forced', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-export-'));
  const dest = path.join(dir, 'cwd');
  await fsp.mkdir(dest);
  await fsp.writeFile(path.join(dest, 'precious.txt'), 'keep me');
  await assert.rejects(() => assertSafeDest(dest, false), /refusing to overwrite/);
  await assertSafeDest(dest, true);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('assertSafeDest allows an empty or session-looking directory', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-export2-'));
  const empty = path.join(dir, 'empty');
  await fsp.mkdir(empty);
  await assertSafeDest(empty, false);
  const sessionish = path.join(dir, 'sess');
  await fsp.mkdir(sessionish);
  await fsp.writeFile(path.join(sessionish, 'answers.json'), '{}');
  await assertSafeDest(sessionish, false);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('progress writes a revision and changed ids', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-delta-'));
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }, { id: 'b', type: 'text', label: 'B' }] });
  const token = 'delta'.repeat(6);
  const srv = await startServer({ sessionDir: dir, spec, token });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    const post = (answers) => fetch(`${base}/api/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers }) });
    await post({ a: 'one' });
    let saved = JSON.parse(await fsp.readFile(path.join(dir, 'progress.json'), 'utf8'));
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.changed, ['a']);
    await post({ a: 'one', b: 'two' });
    saved = JSON.parse(await fsp.readFile(path.join(dir, 'progress.json'), 'utf8'));
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.changed, ['b']);
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('explanation is canonical and content is an alias', () => {
  const a = normalizeSpec({ questions: [{ id: 'q', type: 'text', label: 'Q', explanation: 'Because **why**.' }] });
  assert.equal(a.categories[0].questions[0].explanation, 'Because **why**.');
  assert.equal(a.categories[0].questions[0].content, undefined);
  const b = normalizeSpec({ questions: [{ id: 'q', type: 'text', label: 'Q', content: 'Old field.' }] });
  assert.equal(b.categories[0].questions[0].explanation, 'Old field.');
});

test('matrix requires rows and columns and normalizes shorthand', () => {
  assert.throws(() => normalizeSpec({ questions: [{ type: 'matrix', label: 'm', rows: ['a'] }] }), SpecError);
  const spec = normalizeSpec({
    questions: [{ id: 'm', type: 'matrix', label: 'Rate', rows: ['speed', { value: 'cost', label: 'Cost' }], columns: ['Low', 'High'] }],
  });
  const q = spec.categories[0].questions[0];
  assert.deepEqual(q.rows, [{ value: 'speed', label: 'speed' }, { value: 'cost', label: 'Cost' }]);
  assert.deepEqual(q.columns, [{ value: 'Low', label: 'Low' }, { value: 'High', label: 'High' }]);
});

test('rank needs at least two options', () => {
  assert.throws(() => normalizeSpec({ questions: [{ type: 'rank', label: 'r', options: ['only'] }] }), SpecError);
  const spec = normalizeSpec({ questions: [{ id: 'r', type: 'rank', label: 'Order', options: ['a', 'b', 'c'] }] });
  assert.deepEqual(spec.categories[0].questions[0].options.map((o) => o.value), ['a', 'b', 'c']);
});

test('seedDefaults copies matching answers into question defaults', () => {
  const spec = normalizeSpec({ questions: [{ id: 'a', type: 'text', label: 'A' }, { id: 'b', type: 'multi', label: 'B', options: ['web', 'ios'] }] });
  const seeded = seedDefaults(spec, { a: { type: 'text', value: 'ship v1' }, b: { type: 'multi', value: ['web'] } });
  assert.equal(seeded.categories[0].questions[0].default, 'ship v1');
  assert.deepEqual(seeded.categories[0].questions[1].default, ['web']);
  assert.equal(spec.categories[0].questions[0].default, undefined, 'original not mutated');
});

test('a question then: rule appends follow-ups when its condition matches', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-then-'));
  const spec = normalizeSpec({
    questions: [
      { id: 'pets', type: 'boolean', label: 'Pets?', then: { question: 'pets', equals: true, add: [{ id: 'petnames', type: 'text', label: 'Names' }] } },
    ],
  });
  const token = 'then'.repeat(6);
  const srv = await startServer({ sessionDir: dir, spec, token });
  const base = `http://127.0.0.1:${srv.port}/s/${token}`;
  try {
    await fetch(`${base}/api/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: { pets: true } }) });
    const onDisk = JSON.parse(await fsp.readFile(path.join(dir, 'questions.json'), 'utf8'));
    assert.ok(onDisk.categories.flatMap((c) => c.questions).some((q) => q.id === 'petnames'));
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
