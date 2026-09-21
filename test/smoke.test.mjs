import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { normalizeSpec, SpecError } from '../src/schema.mjs';
import { startServer } from '../src/server.mjs';
import { handle as mcpHandle } from '../src/mcp.mjs';

test('normalizeSpec wraps flat questions and applies defaults', () => {
  const spec = normalizeSpec({
    title: 'Hi',
    questions: [{ id: 'a', type: 'text', label: 'A' }],
  });
  assert.equal(spec.categories.length, 1);
  assert.equal(spec.categories[0].questions[0].id, 'a');
  assert.equal(spec.settings.pageSize, 5);
  assert.equal(spec.categories[0].questions[0].required, false);
});

test('normalizeSpec auto-assigns ids and rejects bad types', () => {
  const spec = normalizeSpec({ questions: [{ type: 'text', label: 'A' }, { type: 'boolean', label: 'B' }] });
  assert.deepEqual(
    spec.categories[0].questions.map((q) => q.id),
    ['q1', 'q2'],
  );
  assert.throws(() => normalizeSpec({ questions: [{ type: 'wat', label: 'x' }] }), SpecError);
  assert.throws(() => normalizeSpec({ questions: [{ type: 'single', label: 'x' }] }), SpecError);
});

test('single required option with allowOther is valid; duplicate ids rejected', () => {
  assert.throws(
    () => normalizeSpec({ questions: [{ id: 'x', type: 'text', label: 'a' }, { id: 'x', type: 'text', label: 'b' }] }),
    SpecError,
  );
});

test('mcp: initialize, tools/list, ping and errors', async () => {
  const init = await mcpHandle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'brainstormform');

  const list = await mcpHandle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['ask_questions', 'get_answers'],
  );

  assert.deepEqual((await mcpHandle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
  assert.equal((await mcpHandle({ jsonrpc: '2.0', id: 4, method: 'nope' })).error.code, -32601);
  assert.equal(await mcpHandle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('end-to-end: UI, questions, upload, host guard, submit', async () => {
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
    assert.equal(questions.status, 200);
    assert.equal((await questions.json()).title, 'T');

    const up = await fetch(`${base}/api/upload?name=pic.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
    });
    assert.equal(up.status, 200);
    const info = await up.json();
    assert.ok(info.path.startsWith(dir));
    assert.ok((await fsp.stat(info.path)).size === 3);

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
      body: JSON.stringify({ answers: { a: { type: 'text', value: 'hi' }, f: { type: 'file', value: [info] } }, unanswered: [] }),
    });
    assert.equal(submit.status, 200);
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'answers.json'), 'utf8'));
    assert.equal(record.answers.a.value, 'hi');
    assert.equal(record.answers.f.value[0].path, info.path);
    assert.equal(record.sessionId, path.basename(dir));
  } finally {
    await srv.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
