import readline from 'node:readline';
import { normalizeSpec, VERSION, SpecError } from './schema.mjs';
import {
  createSession,
  startDetachedServer,
  waitForAnswers,
  stopSession,
  keepSession,
} from './session.mjs';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = PROTOCOL_VERSIONS[0];

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function textResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(typeof payload === 'string' ? {} : { structuredContent: payload }),
    isError,
  };
}

async function finish(sessionId, answers, meta) {
  let output = answers;
  if (meta && meta.keep) {
    const kept = await keepSession(sessionId, answers);
    output = kept.answers;
  }
  await stopSession(sessionId);
  return output;
}

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    settings: { type: 'object', description: 'pageSize, theme ("auto"|"light"|"dark"), submitLabel' },
    categories: { type: 'array', items: { type: 'object' }, description: 'Grouped questions: [{ title, description?, questions: [...] }]' },
    questions: { type: 'array', items: { type: 'object' }, description: 'Flat alternative to categories' },
    open: { type: 'boolean', description: 'Open the form in the default browser (default true)' },
    waitSeconds: { type: 'number', description: 'Block up to this many seconds for the user to submit; 0 returns immediately (default 0)' },
    keep: { type: 'boolean', description: 'Copy the session (with uploads) to ./brainstormform-<id>/ instead of deleting it' },
  },
};

const GET_SCHEMA = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    timeoutSeconds: { type: 'number', description: 'How long to wait for submission (default 600; 0 = return immediately)' },
  },
  required: ['sessionId'],
};

async function callAsk(args) {
  const { open = true, waitSeconds = 0, keep = false, ...spec } = args || {};
  let normalized;
  try {
    normalized = normalizeSpec(spec);
  } catch (err) {
    if (err instanceof SpecError) return textResult('Invalid spec: ' + err.message, true);
    throw err;
  }
  const { id } = await createSession(normalized, { keep });
  const meta = await startDetachedServer(id, { open, idleTimeout: 3600 });
  const info = { sessionId: id, url: meta.url, status: 'pending' };

  if (waitSeconds > 0) {
    const { answers, meta: latest } = await waitForAnswers(id, { timeoutMs: waitSeconds * 1000 });
    if (answers) return textResult(await finish(id, answers, { ...latest, keep }));
  }
  return textResult(info);
}

async function callGet(args) {
  const sessionId = args && args.sessionId;
  if (!sessionId) return textResult('sessionId is required', true);
  const timeoutSeconds = args.timeoutSeconds === undefined ? 600 : args.timeoutSeconds;
  const { answers, meta, error } = await waitForAnswers(sessionId, {
    timeoutMs: timeoutSeconds > 0 ? timeoutSeconds * 1000 : 1,
  });
  if (answers) return textResult(await finish(sessionId, answers, meta));
  if (error === 'unknown-session') return textResult('Unknown session "' + sessionId + '".', true);
  if (error === 'server-exited') return textResult('Session "' + sessionId + '" ended before submission.', true);
  return textResult({ status: 'pending', sessionId, url: meta && meta.url });
}

export async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.id === undefined) return null;
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const requested = params && params.protocolVersion;
    return ok(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'brainstormform', version: VERSION },
      instructions: 'Call ask_questions to open a browser form with any number of brainstorming questions, then get_answers to receive them.',
    });
  }
  if (method === 'tools/list') {
    return ok(id, {
      tools: [
        {
          name: 'ask_questions',
          description:
            'Open a paginated local web form containing any number of questions (single/multi choice, text, number/scale, boolean, file upload), grouped into categories. Returns a sessionId and a url for the user to answer in the browser.',
          inputSchema: ASK_SCHEMA,
        },
        {
          name: 'get_answers',
          description: 'Wait for (or poll) the answers of a brainstormform session and return them as JSON. The session is deleted after the answers are read.',
          inputSchema: GET_SCHEMA,
        },
      ],
    });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      if (name === 'ask_questions') return ok(id, await callAsk(args));
      if (name === 'get_answers') return ok(id, await callGet(args));
      return ok(id, textResult('Unknown tool "' + name + '"', true));
    } catch (err) {
      return ok(id, textResult('Error: ' + (err && err.message ? err.message : String(err)), true));
    }
  }
  if (method === 'ping') return ok(id, {});
  return error(id, -32601, 'Method not found: ' + method);
}

export function runMcp() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send(error(null, -32700, 'Parse error'));
      return;
    }
    const messages = Array.isArray(msg) ? msg : [msg];
    chain = chain.then(async () => {
      const responses = [];
      for (const m of messages) {
        const response = await handle(m);
        if (response) responses.push(response);
      }
      if (responses.length === 1) send(responses[0]);
      else if (responses.length > 1) send(responses);
    });
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      chain.finally(resolve);
    });
  });
}
