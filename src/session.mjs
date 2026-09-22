import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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

export function stateRoot() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'brainstormform');
}

export function sessionDir(id) {
  const safe = String(id == null ? '' : id);
  if (!/^bf-[a-z0-9-]+$/i.test(safe)) throw new Error('invalid session id "' + safe + '".');
  return path.join(sessionsRoot(), safe);
}

export function metaPath(id) {
  return path.join(sessionDir(id), 'meta.json');
}

export function answersPath(id) {
  return path.join(sessionDir(id), 'answers.json');
}

export function progressPath(id) {
  return path.join(sessionDir(id), 'progress.json');
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

export async function createSession(spec, { keep, out, commit, archive, onSubmit } = {}) {
  const id = newSessionId();
  const dir = sessionDir(id);
  await fsp.mkdir(path.join(dir, 'uploads'), { recursive: true });
  await writeJsonAtomic(path.join(dir, 'questions.json'), spec);
  await writeJsonAtomic(path.join(dir, 'meta.json'), {
    id,
    token: newToken(),
    title: spec.title,
    keep: keep === true,
    out: out === undefined || out === false ? false : out === true ? true : String(out),
    commit: commit === true,
    archive: archive === true,
    onSubmit: onSubmit ? String(onSubmit) : undefined,
    status: 'open',
    revision: 1,
    questionCount: spec.categories.reduce((n, c) => n + c.questions.length, 0),
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

  const file = metaPath(id);
  const deadline = Date.now() + 5000;
  let meta = null;
  while (Date.now() < deadline) {
    meta = await readJson(file, null);
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
  const file = path.join(dir, 'answers.json');
  const start = Date.now();
  let meta = await readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return { answers: null, dir, error: 'unknown-session' };

  while (true) {
    const answers = await readJson(file, null);
    if (answers) return { answers, dir, meta };

    meta = (await readJson(path.join(dir, 'meta.json'), null)) || meta;
    if (meta.pid && !isAlive(meta.pid)) {
      const late = await readJson(file, null);
      if (late) return { answers: late, dir, meta };
      return { answers: null, dir, meta, error: 'server-exited' };
    }
    if (Number.isFinite(timeoutMs) && Date.now() - start >= timeoutMs) {
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

const SESSION_MARKERS = ['answers.json', 'questions.json', 'meta.json'];

export async function assertSafeDest(dest, force = false) {
  let stat;
  try {
    stat = await fsp.stat(dest);
  } catch {
    return;
  }
  if (!stat.isDirectory()) throw new Error('output path exists and is not a directory: ' + dest);
  const entries = await fsp.readdir(dest);
  if (entries.length === 0) return;
  if (entries.some((name) => SESSION_MARKERS.includes(name))) return;
  if (force) return;
  throw new Error('refusing to overwrite non-empty directory ' + dest + ' (pass --force to overwrite)');
}

export async function exportSession(id, answers, dest, { force = false } = {}) {
  await assertSafeDest(dest, force);
  const dir = sessionDir(id);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(path.join(dir, 'questions.json'), path.join(dest, 'questions.json')).catch(() => {});
  await fsp.cp(path.join(dir, 'uploads'), path.join(dest, 'uploads'), { recursive: true }).catch(() => {});
  const rewritten = rewritePaths(answers, dir, dest);
  await writeJsonAtomic(path.join(dest, 'answers.json'), rewritten);
  return { dir: dest, answers: rewritten };
}

export async function keepSession(id, answers) {
  return exportSession(id, answers, path.join(process.cwd(), `brainstormform-${id}`));
}

export async function seedSession(fromId, spec) {
  const dir = sessionDir(fromId);
  const record = (await readJson(path.join(dir, 'answers.json'), null)) || (await readJson(path.join(dir, 'progress.json'), null));
  if (!record) throw new Error('source session "' + fromId + '" has no answers yet.');
  const { seedDefaults } = await import('./schema.mjs');
  return seedDefaults(spec, record.answers || {});
}

export function resolveOutDir(meta, id) {
  if (meta.out === true) return path.join(process.cwd(), '.brainstormform', id);
  return path.resolve(process.cwd(), String(meta.out));
}

export async function archiveSession(id, answers) {
  const dest = path.join(stateRoot(), id);
  const result = await exportSession(id, answers, dest);
  const meta = (await readJson(metaPath(id), null)) || {};
  const indexFile = path.join(stateRoot(), 'index.jsonl');
  const line = JSON.stringify({
    id,
    title: meta.title || undefined,
    archivedAt: new Date().toISOString(),
    submittedAt: answers && answers.submittedAt,
    answers: answers && answers.answers ? Object.keys(answers.answers).length : 0,
    dir: result.dir,
  });
  await fsp.mkdir(stateRoot(), { recursive: true });
  await fsp.appendFile(indexFile, line + '\n');
  return result;
}

export async function archiveList() {
  const file = path.join(stateRoot(), 'index.jsonl');
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

export function gitCommit(dir, message) {
  const add = spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  if (add.status !== 0) return { ok: false, error: (add.stderr || add.stdout || '').trim() };
  const commit = spawnSync('git', ['-C', dir, 'commit', '-m', message, '--no-verify'], {
    encoding: 'utf8',
  });
  if (commit.status !== 0) {
    const text = (commit.stderr || commit.stdout || '').trim();
    if (/nothing to commit/i.test(text)) return { ok: true, skipped: true };
    return { ok: false, error: text };
  }
  return { ok: true };
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
    const progress = await readJson(path.join(dir, 'progress.json'), null);
    out.push({
      id: meta.id || id,
      url: meta.url,
      title: meta.title,
      status: meta.status || (answers ? 'submitted' : 'open'),
      revision: meta.revision,
      createdAt: meta.createdAt,
      submitted: !!answers,
      answered: progress && progress.answers ? Object.keys(progress.answers).length : 0,
      alive: isAlive(meta.pid),
      dir,
    });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function cleanupStale() {
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
