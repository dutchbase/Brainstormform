import http from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic, sessionDir, openBrowser } from './session.mjs';
import { appendFragment, allQuestions, SpecError } from './schema.mjs';
import { evaluateShowIf } from './render.mjs';
import { parseArgs } from './args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH = path.join(__dirname, 'ui.html');
const RENDER_PATH = path.join(__dirname, 'render.mjs');
const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const MAX_UPLOADS = 200; // ponytail: per-session cap; raise it if bulk uploads matter
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function sanitizeName(name) {
  const base = path.basename(String(name || 'file'));
  const clean = base.replace(/[^\w.\-() ]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return clean || 'file';
}

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        reject(new Error('payload-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => {
      if (!tooBig) reject(err);
    });
  });
}

function buildAssets(spec, token) {
  const root = process.cwd();
  const clientSpec = JSON.parse(JSON.stringify(spec));
  const assets = [];
  for (const cat of clientSpec.categories) {
    for (const q of cat.questions) {
      if (q.type !== 'visual' || !Array.isArray(q.options)) continue;
      for (const option of q.options) {
        if (!option.image || /^https?:\/\//i.test(option.image)) continue;
        const resolved = path.resolve(root, option.image);
        const rel = path.relative(root, resolved);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        assets.push(resolved);
        option.image = `/s/${token}/api/asset/${assets.length - 1}`;
      }
    }
  }
  return { assets, clientSpec };
}

export async function startServer({
  sessionDir: dir,
  spec: initialSpec,
  token,
  maxUpload = 25 * 1024 * 1024,
  onSubmitted,
  onActivity,
  onSubmitCommand,
}) {
  const uploadsDir = path.join(dir, 'uploads');
  const answersPath = path.join(dir, 'answers.json');
  const progressPath = path.join(dir, 'progress.json');
  const questionsPath = path.join(dir, 'questions.json');
  const metaFile = path.join(dir, 'meta.json');
  await fsp.mkdir(uploadsDir, { recursive: true });
  const uiHtml = await fsp.readFile(UI_PATH, 'utf8');
  const renderSrc = await fsp.readFile(RENDER_PATH, 'utf8');

  let revision = 1;
  let status = 'open';
  let uploads = 0;
  let progressRevision = 0;
  let spec = initialSpec;
  let built = buildAssets(spec, token);
  const sse = new Set();
  const sessionId = path.basename(dir);
  let url = '';

  function clientSpec() {
    return built.clientSpec;
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sse) {
      try {
        res.write(payload);
      } catch {
        /* dropped */
      }
    }
  }

  async function syncMeta(extra = {}) {
    const meta = (await readJson(metaFile, null)) || {};
    await writeJsonAtomic(metaFile, {
      ...meta,
      status,
      revision,
      questionCount: allQuestions(spec).length,
      ...extra,
    });
  }

  function rawAnswers(answers) {
    const out = {};
    for (const [key, value] of Object.entries(answers || {})) {
      out[key] = value && typeof value === 'object' && !Array.isArray(value) && 'type' in value ? value.value : value;
    }
    return out;
  }

  async function runThenRules(answers) {
    const rules = allQuestions(spec).filter((q) => q.then);
    for (const q of rules) {
      if (q.then.fired) continue;
      if (!evaluateShowIf({ question: q.then.question, op: q.then.op, value: q.then.value }, answers)) continue;
      q.then.fired = true;
      try {
        spec = appendFragment(spec, q.then.add);
        revision += 1;
        built = buildAssets(spec, token);
        await writeJsonAtomic(questionsPath, spec);
        await syncMeta();
        broadcast('appended', { revision, status, spec: clientSpec() });
      } catch {
        /* invalid follow-up: ignore, do not crash the session */
      }
    }
  }

  async function runHook() {
    if (!onSubmitCommand) return;
    try {
      const child = spawn(onSubmitCommand, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          BRAINSTORMFORM_ANSWERS: answersPath,
          BRAINSTORMFORM_SESSION: sessionId,
          BRAINSTORMFORM_URL: url,
        },
      });
      child.unref();
    } catch {
      /* non-fatal */
    }
  }

  async function handle(req, res) {
    if (onActivity) onActivity();
    const host = req.headers.host || '';
    if (!HOST_RE.test(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden host');
      return;
    }

    const parsed = new URL(req.url, `http://${host}`);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] !== 's' || segments[1] !== token) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const rest = segments.slice(2);

    if (rest.length === 0 && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data: https:; connect-src 'self'; form-action 'none'; base-uri 'none'",
      });
      res.end(uiHtml.replaceAll('__BF_BASE_URL__', `/s/${token}`));
      return;
    }

    if (rest[0] === 'app' && rest[1] === 'render.mjs' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(renderSrc);
      return;
    }

    if (rest[0] !== 'api') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    const action = rest[1];

    if (action === 'questions' && req.method === 'GET') {
      sendJson(res, 200, { spec: clientSpec(), revision, status });
      return;
    }

    if (action === 'progress' && req.method === 'GET') {
      sendJson(res, 200, (await readJson(progressPath, null)) || { answers: {}, other: {}, notes: {}, skipped: [] });
      return;
    }

    if (action === 'status' && req.method === 'GET') {
      const answers = await readJson(answersPath, null);
      sendJson(res, 200, { submitted: !!answers, status, revision });
      return;
    }

    if (action === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ revision, status })}\n\n`);
      sse.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* dropped */
        }
      }, 20000);
      req.on('close', () => {
        clearInterval(heartbeat);
        sse.delete(res);
      });
      return;
    }

    if (action === 'asset' && req.method === 'GET') {
      const index = Number(rest[2]);
      const file = built.assets[index];
      if (!file) {
        sendJson(res, 404, { error: 'unknown asset' });
        return;
      }
      try {
        await fsp.access(file);
      } catch {
        sendJson(res, 404, { error: 'asset not found' });
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (action === 'progress' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req, 2 * 1024 * 1024);
      } catch {
        sendJson(res, 413, { error: 'progress too large' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' });
        return;
      }
      const prev = (await readJson(progressPath, null)) || {};
      const nextAnswers = payload.answers || {};
      const changed = new Set();
      const track = (before, after) => {
        const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
        for (const key of keys) if (JSON.stringify((before || {})[key]) !== JSON.stringify((after || {})[key])) changed.add(key);
      };
      track(prev.answers, nextAnswers);
      track(prev.other, payload.other);
      track(prev.notes, payload.notes);
      progressRevision += 1;
      await writeJsonAtomic(progressPath, {
        answers: nextAnswers,
        other: payload.other || {},
        notes: payload.notes && typeof payload.notes === 'object' ? payload.notes : {},
        skipped: Array.isArray(payload.skipped) ? payload.skipped : [],
        revision: progressRevision,
        changed: [...changed],
        updatedAt: new Date().toISOString(),
      });
      await runThenRules(nextAnswers);
      sendJson(res, 200, { ok: true, revision, progressRevision, status });
      return;
    }

    if (action === 'append' && req.method === 'POST') {
      if (status !== 'open') {
        sendJson(res, 409, { error: 'session already submitted; start a new session' });
        return;
      }
      let body;
      try {
        body = await readBody(req, 2 * 1024 * 1024);
      } catch {
        sendJson(res, 413, { error: 'fragment too large' });
        return;
      }
      let fragment;
      try {
        fragment = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' });
        return;
      }
      let next;
      try {
        next = appendFragment(spec, fragment);
      } catch (err) {
        if (err instanceof SpecError) {
          sendJson(res, 400, { error: err.message });
          return;
        }
        throw err;
      }
      spec = next;
      revision += 1;
      built = buildAssets(spec, token);
      await writeJsonAtomic(questionsPath, spec);
      await syncMeta();
      broadcast('appended', { revision, status, spec: clientSpec() });
      sendJson(res, 200, { revision, questionCount: allQuestions(spec).length });
      return;
    }

    if (action === 'upload' && req.method === 'POST') {
      if (uploads >= MAX_UPLOADS) {
        sendJson(res, 413, { error: 'too many uploads for this session' });
        return;
      }
      const original = sanitizeName(parsed.searchParams.get('name') || 'file');
      let body;
      try {
        body = await readBody(req, maxUpload);
      } catch (err) {
        if (err.message === 'payload-too-large') {
          sendJson(res, 413, { error: 'file exceeds the upload limit' });
          return;
        }
        throw err;
      }
      const stored = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${original}`;
      const full = path.join(uploadsDir, stored);
      await fsp.writeFile(full, body);
      uploads += 1;
      sendJson(res, 200, {
        name: original,
        path: full,
        size: body.length,
        mime: req.headers['content-type'] || 'application/octet-stream',
      });
      return;
    }

    if (action === 'submit' && req.method === 'POST') {
      if (status === 'submitted') {
        sendJson(res, 409, { error: 'already submitted' });
        return;
      }
      let body;
      try {
        body = await readBody(req, 5 * 1024 * 1024);
      } catch {
        sendJson(res, 413, { error: 'submission too large' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' });
        return;
      }
      const record = {
        sessionId,
        submittedAt: new Date().toISOString(),
        durationMs: payload && payload.durationMs,
        answers: (payload && payload.answers) || {},
        notes: payload && payload.notes && typeof payload.notes === 'object' ? payload.notes : {},
        skipped: Array.isArray(payload && payload.skipped) ? payload.skipped : [],
        unanswered: Array.isArray(payload && payload.unanswered) ? payload.unanswered : [],
        hidden: Array.isArray(payload && payload.hidden) ? payload.hidden : [],
      };
      await writeJsonAtomic(answersPath, record);
      status = 'submitted';
      await runThenRules(rawAnswers(record.answers));
      await syncMeta({ submittedAt: record.submittedAt });
      broadcast('state', { revision, status });
      if (onSubmitted) onSubmitted(record);
      runHook();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'shutdown' && req.method === 'POST') {
      sendJson(res, 200, { ok: true });
      setTimeout(() => server.close(), 50);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        sendJson(res, 500, { error: String((err && err.message) || err) });
      } catch {
        /* response already sent */
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  url = `http://127.0.0.1:${port}/s/${token}`;

  async function close() {
    for (const res of sse) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    sse.clear();
    try {
      server.closeAllConnections?.();
    } catch {
      /* older node */
    }
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    server,
    port,
    url,
    close,
    answersPath,
    uploadsDir,
    getRevision: () => revision,
    getStatus: () => status,
  };
}

async function runDaemon() {
  const args = parseArgs(process.argv.slice(2));
  const id = args.session;
  if (!id) throw new Error('--session is required');
  const dir = sessionDir(id);
  const spec = JSON.parse(await fsp.readFile(path.join(dir, 'questions.json'), 'utf8'));
  const meta = (await readJson(path.join(dir, 'meta.json'), null)) || {};
  if (!meta.token) throw new Error('session meta is missing a token');

  const maxUpload = args['max-upload'] ? Number(args['max-upload']) * 1024 * 1024 : 25 * 1024 * 1024;
  const idleMs = args['idle-timeout'] ? Number(args['idle-timeout']) * 1000 : 60 * 60 * 1000;

  const { port, url, close } = await startServer({
    sessionDir: dir,
    spec,
    token: meta.token,
    maxUpload,
    onActivity: () => touch(),
    onSubmitCommand: meta.onSubmit,
  });

  await writeJsonAtomic(path.join(dir, 'meta.json'), { ...meta, pid: process.pid, port, url });

  let timer;
  let closing = false;
  function touch() {
    clearTimeout(timer);
    if (idleMs > 0) timer = setTimeout(shutdown, idleMs);
  }
  function shutdown() {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    close().finally(async () => {
      if (!meta.keep && !meta.out && !meta.archive) {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  touch();
  if (args.open) openBrowser(url);
  process.stderr.write(`brainstormform: ${url}\n`);
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runDaemon().catch((err) => {
    process.stderr.write('brainstormform server: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  });
}
