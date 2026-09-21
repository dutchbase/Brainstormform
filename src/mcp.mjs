import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpec, VERSION, SpecError } from './schema.mjs';
import {
  createSession,
  startDetachedServer,
  waitForAnswers,
  stopSession,
  keepSession,
  sessionDir,
  readJson,
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

const resourceUri = (sessionId) => `brainstormform://session/${sessionId}`;

const watchers = new Map();

function notify(level, data, uri) {
  send({ jsonrpc: '2.0', method: 'notifications/message', params: { level, logger: 'brainstormform', data } });
  if (uri) send({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } });
}

function startWatch(sessionId) {
  if (watchers.has(sessionId)) return;
  const dir = sessionDir(sessionId);
  let timer = null;
  let closed = false;
  let watcher;
  try {
    watcher = fs.watch(dir, (event, filename) => {
      if (closed || !filename) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const answers = await readJson(path.join(dir, 'answers.json'), null);
        if (answers) {
          notify('info', { sessionId, event: 'submitted' }, resourceUri(sessionId));
        } else {
          notify('info', { sessionId, event: 'updated' }, resourceUri(sessionId));
        }
      }, 250);
    });
  } catch {
    return;
  }
  watchers.set(sessionId, {
    close() {
      closed = true;
      clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      watchers.delete(sessionId);
    },
  });
}

function stopWatch(sessionId) {
  const watcher = watchers.get(sessionId);
  if (watcher) watcher.close();
}

async function finish(sessionId, answers, meta) {
  let output = answers;
  if (meta && meta.keep) {
    const kept = await keepSession(sessionId, answers);
    output = kept.answers;
  }
  stopWatch(sessionId);
  await stopSession(sessionId);
  return output;
}

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    settings: { type: 'object', description: 'pageSize, theme, submitLabel, finishLabel' },
    categories: { type: 'array', items: { type: 'object' }, description: 'Grouped questions: [{ title, intro?, questions: [...] }]' },
    questions: { type: 'array', items: { type: 'object' }, description: 'Flat alternative to categories' },
    open: { type: 'boolean', description: 'Open the form in the default browser (default true)' },
    waitSeconds: { type: 'number', description: 'Block up to this many seconds for the user to finish; 0 returns immediately (default 0)' },
    keep: { type: 'boolean', description: 'Copy the session (with uploads) to ./brainstormform-<id>/ instead of deleting it' },
  },
};

const READ_SCHEMA = {
  type: 'object',
  properties: { sessionId: { type: 'string' } },
  required: ['sessionId'],
};

const ADD_SCHEMA = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    categories: { type: 'array', items: { type: 'object' } },
    questions: { type: 'array', items: { type: 'object' } },
    title: { type: 'string' },
  },
  required: ['sessionId'],
};

const WAIT_SCHEMA = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    timeoutSeconds: { type: 'number', description: 'How long to wait for Finish (default 600); 0 returns immediately so you can poll' },
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
  startWatch(id);
  const info = { sessionId: id, url: meta.url, status: 'open' };

  if (waitSeconds > 0) {
    const { answers, meta: latest } = await waitForAnswers(id, { timeoutMs: waitSeconds * 1000 });
    if (answers) return textResult(await finish(id, answers, { ...latest, keep }));
  }
  return textResult(info);
}

async function callRead(args) {
  const sessionId = args && args.sessionId;
  if (!sessionId) return textResult('sessionId is required', true);
  const dir = sessionDir(sessionId);
  const meta = await readJson(path.join(dir, 'meta.json'), null);
  if (!meta) return textResult('Unknown session "' + sessionId + '".', true);
  const progress = (await readJson(path.join(dir, 'progress.json'), null)) || { answers: {}, other: {}, notes: {}, skipped: [] };
  const final = await readJson(path.join(dir, 'answers.json'), null);
  return textResult({
    sessionId,
    status: meta.status || (final ? 'submitted' : 'open'),
    revision: meta.revision,
    url: meta.url,
    answered: Object.keys(progress.answers || {}).length,
    answers: (final && final.answers) || progress.answers || {},
    other: progress.other || {},
    notes: (final && final.notes) || progress.notes || {},
    skipped: progress.skipped || [],
  });
}

async function callAdd(args) {
  const sessionId = args && args.sessionId;
  if (!sessionId) return textResult('sessionId is required', true);
  const meta = await readJson(path.join(sessionDir(sessionId), 'meta.json'), null);
  if (!meta) return textResult('Unknown session "' + sessionId + '".', true);
  if (!meta.url) return textResult('Session is not live.', true);
  const fragment = { categories: args.categories, questions: args.questions, title: args.title };
  const res = await fetch(meta.url + '/api/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fragment),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return textResult(body.error || 'append failed (HTTP ' + res.status + ')', true);
  return textResult(body);
}

async function callWait(args) {
  const sessionId = args && args.sessionId;
  if (!sessionId) return textResult('sessionId is required', true);
  const timeoutSeconds = args.timeoutSeconds === undefined ? 600 : Number(args.timeoutSeconds);
  const { answers, meta, error } = await waitForAnswers(sessionId, {
    timeoutMs: Number.isFinite(timeoutSeconds) ? Math.max(0, timeoutSeconds) * 1000 : 600000,
  });
  if (answers) return textResult(await finish(sessionId, answers, meta));
  if (error === 'unknown-session') return textResult('Unknown session "' + sessionId + '".', true);
  if (error === 'server-exited') return textResult('Session "' + sessionId + '" ended before submission.', true);
  return textResult({ status: 'open', sessionId, url: meta && meta.url });
}

export async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.id === undefined) return null;
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const requested = params && params.protocolVersion;
    return ok(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: true, subscribe: false } },
      serverInfo: { name: 'brainstormform', version: VERSION },
      instructions:
        'ask_questions opens a live browser form. Answers are saved as the user types: poll read_answers, append follow-ups with add_questions, and call wait_for_answers to block until the user presses Finish.',
    });
  }
  if (method === 'tools/list') {
    return ok(id, {
      tools: [
        {
          name: 'ask_questions',
          description:
            'Open a live, paginated local web form with any number of questions (single/multi choice, image cards, text, number/scale, boolean, file upload), grouped into categories and optionally conditional. Returns a sessionId and url. Answers are saved as the user types; call read_answers to see progress and add_questions to append follow-ups while they are still answering. Every question also accepts a free-text note from the user, returned in "notes" keyed by question id — tell the user they can annotate any answer, it is the right place when no option fits. Prefer this over a built-in question tool when there are more than ~6 questions, when questions need sections, files or follow-ups, or when the user asked for a brainstorm.',
          inputSchema: ASK_SCHEMA,
        },
        {
          name: 'read_answers',
          description: 'Read the answers the user has entered so far in a live session (non-blocking), plus submission status and any per-question notes.',
          inputSchema: READ_SCHEMA,
        },
        {
          name: 'add_questions',
          description: 'Append new questions or categories to a running session. Existing questions cannot be changed. Rejected once the user has finished.',
          inputSchema: ADD_SCHEMA,
        },
        {
          name: 'wait_for_answers',
          description: 'Block until the user presses Finish, then return the final answers and close the session.',
          inputSchema: WAIT_SCHEMA,
        },
      ],
    });
  }
  if (method === 'resources/list') {
    return ok(id, {
      resources: [...watchers.keys()].map((sessionId) => ({
        uri: resourceUri(sessionId),
        name: 'Brainstormform session ' + sessionId,
        mimeType: 'application/json',
      })),
    });
  }
  if (method === 'resources/read') {
    const uri = params && params.uri;
    const sessionId = String(uri || '').replace('brainstormform://session/', '');
    const read = await callRead({ sessionId });
    return ok(id, {
      contents: [{ uri, mimeType: 'application/json', text: read.content[0].text }],
    });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      if (name === 'ask_questions') return ok(id, await callAsk(args));
      if (name === 'read_answers') return ok(id, await callRead(args));
      if (name === 'add_questions') return ok(id, await callAdd(args));
      if (name === 'wait_for_answers' || name === 'get_answers') return ok(id, await callWait(args));
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
        const response = await handle(m).catch((err) =>
          error(m && m.id !== undefined ? m.id : null, -32603, 'Internal error: ' + (err && err.message ? err.message : String(err))),
        );
        if (response) responses.push(response);
      }
      if (responses.length === 1) send(responses[0]);
      else if (responses.length > 1) send(responses);
    });
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      for (const watcher of watchers.values()) watcher.close();
      chain.finally(resolve);
    });
  });
}
