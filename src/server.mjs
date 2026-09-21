import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic, sessionDir, openBrowser } from './session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH = path.join(__dirname, 'ui.html');
const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value !== undefined) out[key] = value;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

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

export async function startServer({ sessionDir: dir, spec, token, maxUpload = 25 * 1024 * 1024, onSubmitted, onActivity }) {
  const uploadsDir = path.join(dir, 'uploads');
  const answersPath = path.join(dir, 'answers.json');
  await fsp.mkdir(uploadsDir, { recursive: true });
  const uiHtml = await fsp.readFile(UI_PATH, 'utf8');

  async function handle(req, res) {
    if (onActivity) onActivity();
    const host = req.headers.host || '';
    if (!HOST_RE.test(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden host');
      return;
    }

    const url = new URL(req.url, `http://${host}`);
    const segments = url.pathname.split('/').filter(Boolean);
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
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; form-action 'none'; base-uri 'none'",
      });
      res.end(uiHtml);
      return;
    }

    if (rest[0] !== 'api') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    const action = rest[1];

    if (action === 'questions' && req.method === 'GET') {
      sendJson(res, 200, spec);
      return;
    }

    if (action === 'status' && req.method === 'GET') {
      const answers = await readJson(answersPath, null);
      sendJson(res, 200, { submitted: !!answers });
      return;
    }

    if (action === 'upload' && req.method === 'POST') {
      const original = sanitizeName(url.searchParams.get('name') || 'file');
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
      sendJson(res, 200, {
        name: original,
        path: full,
        size: body.length,
        mime: req.headers['content-type'] || 'application/octet-stream',
      });
      return;
    }

    if (action === 'submit' && req.method === 'POST') {
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
      const answers = payload && typeof payload === 'object' && payload.answers ? payload : { answers: payload };
      const record = {
        sessionId: path.basename(dir),
        submittedAt: new Date().toISOString(),
        durationMs: payload && payload.durationMs,
        answers: answers.answers || {},
        unanswered: Array.isArray(payload && payload.unanswered) ? payload.unanswered : [],
      };
      await writeJsonAtomic(answersPath, record);
      if (onSubmitted) onSubmitted(record);
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
  const url = `http://127.0.0.1:${port}/s/${token}`;

  async function close() {
    try {
      server.closeAllConnections?.();
    } catch {
      /* older node */
    }
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, port, url, close, answersPath, uploadsDir };
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
      if (!meta.keep) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => {
    clearTimeout(timer);
    close().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => process.exit(0));

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
