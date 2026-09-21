import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { normalizeSpec, normalizeFragment, SpecError } from '../src/schema.mjs';
import { startServer } from '../src/server.mjs';
import { handle as mcpHandle } from '../src/mcp.mjs';

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
    assert.match(await ui.text(), /Brainstormform/);

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
  const img = path.join(dir, 'ref.png');
  await fsp.writeFile(img, Buffer.from([137, 80, 78, 71]));
  const spec = normalizeSpec({
    questions: [{ id: 'v', type: 'visual', label: 'Pick', options: [{ value: 'a', image: img }] }],
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
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
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
    ['ask_questions', 'read_answers', 'add_questions', 'wait_for_answers'],
  );

  assert.deepEqual((await mcpHandle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).result.resources, []);
  assert.deepEqual((await mcpHandle({ jsonrpc: '2.0', id: 4, method: 'ping' })).result, {});
  assert.equal((await mcpHandle({ jsonrpc: '2.0', id: 5, method: 'nope' })).error.code, -32601);
  assert.equal(await mcpHandle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});
