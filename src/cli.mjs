import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSpec, schemaText, guideText, VERSION, SpecError } from './schema.mjs';
import {
  createSession,
  startDetachedServer,
  waitForAnswers,
  stopSession,
  keepSession,
  listSessions,
  cleanupStale,
  sessionDir,
  readJson,
} from './session.mjs';

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

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function fail(message, code = 1) {
  process.stderr.write('brainstormform: ' + message + '\n');
  return code;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function deliver(id, answers, meta) {
  let output = answers;
  if (meta && meta.keep) {
    const kept = await keepSession(id, answers);
    output = kept.answers;
    process.stderr.write('brainstormform: kept a copy at ' + kept.dir + '\n');
  }
  await stopSession(id);
  print(output);
}

async function cmdAsk(args) {
  const source = args._[0];
  let raw;
  if (source && source !== '-') {
    raw = await fsp.readFile(source, 'utf8');
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  } else {
    return fail('no input: pass a questions file, or pipe JSON on stdin.');
  }

  let spec;
  try {
    spec = normalizeSpec(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SpecError || err instanceof SyntaxError) return fail('invalid spec: ' + err.message);
    throw err;
  }

  const keep = args.keep === true;
  const open = args['no-open'] !== true;
  const idleTimeout = args['idle-timeout'] !== undefined ? Number(args['idle-timeout']) : undefined;
  const maxUpload = args['max-upload'] !== undefined ? Number(args['max-upload']) : undefined;

  const { id } = await createSession(spec, { keep });
  const meta = await startDetachedServer(id, { open, idleTimeout, maxUpload });

  print({ sessionId: id, url: meta.url, pid: meta.pid });
  process.stderr.write(
    'brainstormform: form is live. Ask the user to submit, then run:\n' +
      '  brainstormform wait ' + id + ' --timeout 600\n',
  );
  return 0;
}

async function cmdWait(args) {
  const id = args._[0];
  if (!id) return fail('usage: brainstormform wait <sessionId> [--timeout seconds]');
  const timeoutMs = args.timeout !== undefined ? Number(args.timeout) * 1000 : 600000;
  const { answers, meta, error } = await waitForAnswers(id, { timeoutMs });
  if (answers) {
    await deliver(id, answers, meta);
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
    await deliver(id, answers, meta);
    return 0;
  }
  print({ status: 'pending', sessionId: id, url: meta.url });
  return 4;
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

function helpText() {
  return `brainstormform ${VERSION} — local web forms for agent brainstorming

Usage:
  brainstormform ask [questions.json|-] [--open|--no-open] [--keep]
                     [--idle-timeout seconds] [--max-upload MB]
  brainstormform wait <sessionId> [--timeout seconds]   # blocks, prints answers JSON
  brainstormform get <sessionId>                         # non-blocking poll
  brainstormform list | stop <id> | cleanup
  brainstormform schema | guide | mcp | version

ask reads a JSON spec (file or stdin), opens a form in the browser, and prints
{"sessionId","url","pid"}. Then call "wait <sessionId>" to receive the answers.
Answers are deleted once read unless --keep copies them to ./brainstormform-<id>/.
Run "brainstormform guide" for the full question format.
`;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  switch (command) {
    case 'ask':
      return cmdAsk(args);
    case 'wait':
      return cmdWait(args);
    case 'get':
      return cmdGet(args);
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
      process.stdout.write(guideText() + '\n');
      return 0;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(VERSION + '\n');
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
      process.stdout.write(helpText());
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
