import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sessionsRoot() {
  const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(base, 'brainstormform');
}

export function sessionDir(id) {
  return path.join(sessionsRoot(), id);
}

export function newSessionId() {
  return 'bf-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

export function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, file);
}

export async function createSession(spec, { keep } = {}) {
  const id = newSessionId();
  const dir = sessionDir(id);
  await fsp.mkdir(path.join(dir, 'uploads'), { recursive: true });
  await writeJsonAtomic(path.join(dir, 'questions.json'), spec);
  await writeJsonAtomic(path.join(dir, 'meta.json'), {
    id,
    token: newToken(),
    keep: keep === true,
    createdAt: new Date().toISOString(),
    pid: null,
    port: null,
    url: null,
  });
  return { id, dir };
}

export async function startDetachedServer(id, { open, idleTimeout, maxUpload } = {}) {
  const args = [SERVER_PATH, '--session', id];
  if (open) args.push('--open');
  if (Number.isFinite(idleTimeout)) args.push('--idle-timeout', String(idleTimeout));
  if (Number.isFinite(maxUpload)) args.push('--max-upload', String(maxUpload));

  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  const metaPath = path.join(sessionDir(id), 'meta.json');
  const deadline = Date.now() + 5000;
  let meta = null;
  while (Date.now() < deadline) {
    meta = await readJson(metaPath, null);
    if (meta && meta.port && meta.url) return meta;
    if (meta && meta.pid && !isAlive(meta.pid) && !meta.port) {
      throw new Error('brainstormform server exited during startup');
    }
    await sleep(50);
  }
  if (!meta || !meta.url) throw new Error('brainstormform server did not start in time');
  return meta;
}

export async function waitForAnswers(id, { timeoutMs = 600000, pollMs = 300 } = {}) {
  const dir = sessionDir(id);
  const answersPath = path.join(dir, 'answers.json');
  const start = Date.now();
  let meta = await readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return { answers: null, dir, error: 'unknown-session' };

  while (true) {
    const answers = await readJson(answersPath, null);
    if (answers) return { answers, dir, meta };

    meta = (await readJson(path.join(dir, 'meta.json'), null)) || meta;
    if (meta.pid && !isAlive(meta.pid)) {
      const late = await readJson(answersPath, null);
      if (late) return { answers: late, dir, meta };
      return { answers: null, dir, meta, error: 'server-exited' };
    }
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) {
      return { answers: null, dir, meta, error: 'timeout' };
    }
    await sleep(pollMs);
  }
}

function rewritePaths(value, fromDir, toDir) {
  if (typeof value === 'string') {
    return value.startsWith(fromDir + path.sep) ? path.join(toDir, value.slice(fromDir.length + 1)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, fromDir, toDir));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = rewritePaths(value[key], fromDir, toDir);
    return out;
  }
  return value;
}

export async function keepSession(id, answers) {
  const dir = sessionDir(id);
  const dest = path.join(process.cwd(), `brainstormform-${id}`);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.cp(dir, dest, { recursive: true });
  const kept = rewritePaths(answers, dir, dest);
  await writeJsonAtomic(path.join(dest, 'answers.json'), kept);
  return { dir: dest, answers: kept };
}

export async function stopSession(id) {
  const dir = sessionDir(id);
  const meta = await readJson(path.join(dir, 'meta.json'), null);
  if (meta && meta.pid && isAlive(meta.pid)) {
    try {
      process.kill(meta.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 20 && isAlive(meta.pid); i++) await sleep(25);
  }
  await fsp.rm(dir, { recursive: true, force: true });
}

export async function listSessions() {
  const root = sessionsRoot();
  let ids;
  try {
    ids = await fsp.readdir(root);
  } catch {
    return [];
  }
  const out = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    const meta = await readJson(path.join(dir, 'meta.json'), null);
    if (!meta) continue;
    const answers = await readJson(path.join(dir, 'answers.json'), null);
    out.push({
      id: meta.id || id,
      url: meta.url,
      createdAt: meta.createdAt,
      submitted: !!answers,
      alive: isAlive(meta.pid),
      dir,
    });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function cleanupStale() {
  const root = sessionsRoot();
  const removed = [];
  for (const session of await listSessions()) {
    if (!session.alive && !session.submitted) {
      await fsp.rm(session.dir, { recursive: true, force: true });
      removed.push(session.id);
    }
  }
  return removed;
}

export function browserOpenCommand(url) {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

export function openBrowser(url) {
  try {
    const [cmd, args] = browserOpenCommand(url);
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* non-fatal, the url is printed anyway */
  }
}
