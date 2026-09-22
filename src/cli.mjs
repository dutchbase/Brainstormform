import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { normalizeSpec, schemaText, guideText, VERSION, SpecError } from './schema.mjs';
import { formatAnswers } from './render.mjs';
import { parseArgs } from './args.mjs';
import {
  createSession,
  startDetachedServer,
  waitForAnswers,
  stopSession,
  keepSession,
  exportSession,
  archiveSession,
  archiveList,
  gitCommit,
  listSessions,
  cleanupStale,
  sessionDir,
  readJson,
  resolveOutDir,
} from './session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(__dirname, '..', 'skills', 'brainstormform', 'SKILL.md');

let JSON_MODE = false;

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function emit(spec, record, format) {
  if (format === 'md' || format === 'markdown') {
    process.stdout.write(formatAnswers(spec, record, 'md') + '\n');
    return;
  }
  print(formatAnswers(spec, record, format));
}

function fail(message, code = 1) {
  if (JSON_MODE) process.stderr.write(JSON.stringify({ error: message, code }) + '\n');
  else process.stderr.write('brainstormform: ' + message + '\n');
  return code;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readInput(source) {
  if (source && source !== '-') return fsp.readFile(source, 'utf8');
  if (!process.stdin.isTTY) return readStdin();
  return null;
}

async function deliver(id, answers, meta, format) {
  let output = answers;
  if (meta.out) {
    const dest = resolveOutDir(meta, id);
    const result = await exportSession(id, answers, dest, { force: meta.force === true });
    output = result.answers;
    process.stderr.write('brainstormform: wrote output to ' + result.dir + '\n');
    if (meta.commit) {
      const commit = gitCommit(result.dir, `brainstormform: ${meta.title || id}`);
      if (!commit.ok) process.stderr.write('brainstormform: git commit failed: ' + commit.error + '\n');
    }
  }
  if (meta.keep) {
    const result = await keepSession(id, answers);
    output = result.answers;
    process.stderr.write('brainstormform: kept a copy at ' + result.dir + '\n');
  }
  if (meta.archive) {
    const result = await archiveSession(id, answers);
    output = result.answers;
    process.stderr.write('brainstormform: archived at ' + result.dir + '\n');
  }
  const spec = await readJson(path.join(sessionDir(id), 'questions.json'), null);
  await stopSession(id);
  emit(spec || { title: (meta && meta.title) || '', categories: [] }, output, format);
}

async function cmdAsk(args) {
  const source = args._[0];
  const raw = await readInput(source);
  if (raw === null) return fail('no input: pass a questions file, or pipe JSON on stdin.');

  let spec;
  try {
    spec = normalizeSpec(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SpecError || err instanceof SyntaxError) return fail('invalid spec: ' + err.message);
    throw err;
  }

  const options = {
    keep: args.keep === true,
    out: args.out === undefined ? false : args.out === true ? true : String(args.out),
    commit: args.commit === true,
    archive: args.archive === true,
    force: args.force === true,
    onSubmit: args['on-submit'] ? String(args['on-submit']) : undefined,
  };
  const open = args['no-open'] !== true;
  const idleTimeout = args['idle-timeout'] !== undefined ? Number(args['idle-timeout']) : undefined;
  const maxUpload = args['max-upload'] !== undefined ? Number(args['max-upload']) : undefined;

  const { id } = await createSession(spec, options);
  const meta = await startDetachedServer(id, { open, idleTimeout, maxUpload });

  print({ sessionId: id, url: meta.url, pid: meta.pid });
  process.stderr.write(
    'brainstormform: form is live. The user can answer at their own pace.\n' +
      '  add follow-ups:  brainstormform add ' + id + ' fragment.json\n' +
      '  read progress:   brainstormform progress ' + id + '\n' +
      '  wait for finish: brainstormform wait ' + id + ' --timeout 600\n',
  );
  return 0;
}

async function cmdWait(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform wait <sessionId> [--timeout seconds]');
  const seconds = args.timeout !== undefined ? Number(args.timeout) : 600;
  const timeoutMs = Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : 600000;
  const { answers, meta, error } = await waitForAnswers(id, { timeoutMs });
  if (answers) {
    await deliver(id, answers, meta, args.format);
    return 0;
  }
  if (error === 'timeout') return fail('timed out waiting for submission; call wait again to keep waiting.', 3);
  if (error === 'server-exited') return fail('server exited before the form was submitted.', 5);
  return fail('unknown session "' + id + '".', 1);
}

async function cmdGet(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform get <sessionId>');
  const dir = sessionDir(id);
  const meta = await readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return fail('unknown session "' + id + '".', 1);
  const answers = await readJson(path.join(dir, 'answers.json'), null);
  if (answers) {
    await deliver(id, answers, meta, args.format);
    return 0;
  }
  print({ status: meta.status || 'open', sessionId: id, url: meta.url });
  return 4;
}

async function cmdProgress(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform progress <sessionId>');
  const dir = sessionDir(id);
  const meta = await readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return fail('unknown session "' + id + '".', 1);
  const progress = (await readJson(path.join(dir, 'progress.json'), null)) || { answers: {}, other: {}, notes: {}, skipped: [] };
  const final = await readJson(path.join(dir, 'answers.json'), null);
  const progressRev = progress.revision || 0;
  const since = args.since !== undefined ? Number(args.since) : null;
  const hasSince = Number.isFinite(since);
  const upToDate = hasSince && since >= progressRev;
  const oneBehind = hasSince && since === progressRev - 1;
  const changed = Array.isArray(progress.changed) ? progress.changed : [];
  const allAnswers = (final && final.answers) || progress.answers || {};
  const allOther = progress.other || {};
  const allNotes = (final && final.notes) || progress.notes || {};
  const pick = (obj) => Object.fromEntries(changed.filter((k) => k in (obj || {})).map((k) => [k, obj[k]]));
  const record = {
    sessionId: id,
    status: meta.status || (final ? 'submitted' : 'open'),
    revision: meta.revision,
    progressRevision: progressRev,
    changed: upToDate ? [] : changed,
    url: meta.url,
    answered: Object.keys(progress.answers || {}).length,
    answers: upToDate ? {} : oneBehind ? pick(allAnswers) : allAnswers,
    other: upToDate ? {} : oneBehind ? pick(allOther) : allOther,
    notes: upToDate ? {} : oneBehind ? pick(allNotes) : allNotes,
    skipped: progress.skipped || [],
  };
  if (hasSince) {
    print(record);
  } else if (args.format === 'json' || args.format === 'md') {
    const spec = await readJson(path.join(dir, 'questions.json'), null);
    emit(spec, record, args.format);
  } else {
    print(record);
  }
  return 0;
}

async function cmdAdd(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform add <sessionId> <fragment.json|->');
  const raw = await readInput(args._[1]);
  if (raw === null) return fail('no fragment: pass a JSON file, or pipe JSON on stdin.');
  let fragment;
  try {
    fragment = JSON.parse(raw);
  } catch (err) {
    return fail('invalid fragment JSON: ' + err.message);
  }
  const meta = await readJson(path.join(sessionDir(id), 'meta.json'), null);
  if (!meta) return fail('unknown session "' + id + '".', 1);
  if (!meta.url) return fail('session has no live url (it may have exited).', 5);

  let res;
  try {
    res = await fetch(meta.url + '/api/append', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fragment),
    });
  } catch (err) {
    return fail('could not reach the session: ' + err.message, 5);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return fail(body.error || 'append failed (HTTP ' + res.status + ')', res.status === 409 ? 4 : 1);
  print(body);
  return 0;
}

async function cmdExport(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform export <sessionId> --to <dir>');
  const dir = sessionDir(id);
  const answers = await readJson(path.join(dir, 'answers.json'), null);
  if (!answers) return fail('session "' + id + '" has no submitted answers yet.', 4);
  const dest = args.to ? path.resolve(String(args.to)) : path.join(process.cwd(), `.brainstormform/${id}`);
  const result = await exportSession(id, answers, dest, { force: args.force === true });
  if (args.format === 'json' || args.format === 'md') {
    const spec = await readJson(path.join(dir, 'questions.json'), null);
    emit(spec, { answers: result.answers }, args.format);
  } else {
    print({ dir: result.dir, answers: result.answers });
  }
  return 0;
}

async function cmdArchive(args) {
  if (args._[0] === 'list' || args.list) {
    print(await archiveList());
    return 0;
  }
  return fail('usage: brainstormform archive list');
}

async function cmdList() {
  print(await listSessions());
  return 0;
}

async function cmdStop(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform stop <sessionId>');
  await stopSession(id);
  print({ stopped: id });
  return 0;
}

async function cmdCleanup() {
  const removed = await cleanupStale();
  print({ removed });
  return 0;
}

function skillRoots() {
  const home = os.homedir();
  return {
    agents: path.join(home, '.agents', 'skills'),
    opencode: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'skills'),
    claude: path.join(home, '.claude', 'skills'),
  };
}

async function cmdInstallSkill(args) {
  if (args.list) {
    print(skillRoots());
    return 0;
  }
  try {
    await fsp.access(SKILL_SRC);
  } catch {
    return fail('bundled skill not found at ' + SKILL_SRC);
  }
  const roots = skillRoots();
  const installed = [];

  if (args.dir) {
    const dest = path.resolve(String(args.dir), 'brainstormform', 'SKILL.md');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(SKILL_SRC, dest);
    installed.push(dest);
    print({ installed, restart: 'Restart your agent so it picks up the new skill.' });
    return 0;
  }

  const requested = args.target ? String(args.target) : 'all';
  const names = requested === 'all' ? Object.keys(roots) : requested.split(',').map((s) => s.trim());

  for (const name of names) {
    const root = roots[name];
    if (!root) return fail('unknown skill target "' + name + '". Use agents, opencode, claude or all.');
    const dest = path.join(root, 'brainstormform', 'SKILL.md');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(SKILL_SRC, dest);
    installed.push(dest);
  }

  print({ installed, restart: 'Restart your agent so it picks up the new skill.' });
  return 0;
}

async function cmdSetup(args) {
  const targets = args.target ? String(args.target).split(',').map((s) => s.trim()) : undefined;
  const { runSetup } = await import('./setup.mjs');
  const result = await runSetup({
    yes: args.yes === true || args.y === true,
    targets,
    log: (message) => process.stderr.write('brainstormform: ' + message + '\n'),
  });
  print(result);
  return 0;
}

async function cmdDoctor(args) {
  const { runDoctor } = await import('./doctor.mjs');
  const report = await runDoctor({ version: VERSION });
  if (args.json || JSON_MODE) {
    print(report);
  } else {
    for (const check of report.checks) {
      process.stdout.write((check.ok ? 'ok    ' : 'FAIL  ') + check.name.padEnd(16) + check.detail + '\n');
    }
    process.stdout.write('\n' + (report.ok ? 'All checks passed.' : 'Some checks need attention.') + '\n');
  }
  return report.ok ? 0 : 1;
}

function cmdUpdate(args) {
  const pkg = 'brainstormform';
  const view = spawnSync('npm', ['view', pkg, 'version'], { encoding: 'utf8' });
  if (view.status !== 0 || !view.stdout.trim()) {
    return fail('the npm package is not published yet. Update with:\n  npm install -g github:dutchbase/Brainstormform', 1);
  }
  const latest = view.stdout.trim();
  if (latest === VERSION) {
    print({ version: VERSION, latest, upToDate: true });
    return 0;
  }
  if (args.check) {
    print({ version: VERSION, latest, upToDate: false });
    return 0;
  }
  process.stderr.write('brainstormform: updating ' + VERSION + ' -> ' + latest + '\n');
  const install = spawnSync('npm', ['install', '-g', pkg + '@latest'], { stdio: 'inherit' });
  if (install.status !== 0) return fail('npm install failed', 1);
  print({ version: latest, updated: true });
  return 0;
}

function helpText() {
  return `brainstormform ${VERSION} — live local web forms for agent brainstorming

Usage:
  brainstormform ask [questions.json|-] [--open|--no-open] [--keep]
                     [--out [dir]] [--commit] [--archive] [--force]
                     [--on-submit "cmd"] [--idle-timeout s] [--max-upload MB]
  brainstormform progress <id>                 # current draft answers + status
  brainstormform add <id> <fragment.json|->    # append questions to a live form
  brainstormform wait <id> [--timeout s]       # block until the user presses Finish
  brainstormform get <id>                      # non-blocking poll
  brainstormform export <id> --to <dir>        # materialise a finished session
  brainstormform archive list
  brainstormform setup [--target claude,codex,opencode] [--yes]
  brainstormform doctor [--json]
  brainstormform update [--check]
  brainstormform install-skill [--target agents|opencode|claude|all]
  brainstormform list | stop <id> | cleanup
  brainstormform schema | guide | mcp | version

ask prints {"sessionId","url","pid"}. Answers are saved to the server as the user
types, so "progress" reflects live input and "add" can append follow-up questions
while the user is still answering. "wait" resolves only when the user finishes.
Run "brainstormform guide" for the question format.
`;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  JSON_MODE = args.json === true;

  switch (command) {
    case 'ask':
      return cmdAsk(args);
    case 'wait':
      return cmdWait(args);
    case 'get':
      return cmdGet(args);
    case 'progress':
      return cmdProgress(args);
    case 'add':
      return cmdAdd(args);
    case 'export':
      return cmdExport(args);
    case 'archive':
      return cmdArchive(args);
    case 'install-skill':
      return cmdInstallSkill(args);
    case 'setup':
      return cmdSetup(args);
    case 'doctor':
      return cmdDoctor(args);
    case 'update':
      return cmdUpdate(args);
    case 'list':
      return cmdList();
    case 'stop':
      return cmdStop(args);
    case 'cleanup':
      return cmdCleanup();
    case 'schema':
      process.stdout.write(schemaText() + '\n');
      return 0;
    case 'guide':
      if (JSON_MODE) print({ guide: guideText() });
      else process.stdout.write(guideText() + '\n');
      return 0;
    case 'version':
    case '--version':
    case '-v':
      if (JSON_MODE) print({ version: VERSION });
      else process.stdout.write(VERSION + '\n');
      return 0;
    case 'mcp': {
      const { runMcp } = await import('./mcp.mjs');
      await runMcp();
      return undefined;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      if (JSON_MODE) print({ help: helpText() });
      else process.stdout.write(helpText());
      return 0;
    default:
      return fail('unknown command "' + command + '". Run "brainstormform help".');
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    if (typeof code === 'number') process.exitCode = code;
  }).catch((err) => {
    process.stderr.write('brainstormform: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  });
}
