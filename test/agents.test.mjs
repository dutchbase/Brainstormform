import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { mergeJsonSection, mergeCodexToml, detectAgents, opencodeEntry, applyConfig } from '../src/agents.mjs';

const BIN = '/opt/brainstormform';
const NODE = '/usr/bin/node';

test('mergeJsonSection adds an entry and keeps existing keys', () => {
  const existing = JSON.stringify({ theme: 'dark', mcp: { other: { type: 'local' } } });
  const { text, changed } = mergeJsonSection(existing, {
    section: 'mcp',
    key: 'brainstormform',
    entry: opencodeEntry(BIN, NODE),
  });
  const parsed = JSON.parse(text);
  assert.equal(changed, true);
  assert.equal(parsed.theme, 'dark');
  assert.deepEqual(parsed.mcp.other, { type: 'local' });
  assert.deepEqual(parsed.mcp.brainstormform.command, [NODE, BIN, 'mcp']);
});

test('mergeJsonSection is idempotent and refuses invalid JSON', () => {
  const entry = { command: NODE, args: [BIN, 'mcp'] };
  const first = mergeJsonSection('', { section: 'mcpServers', key: 'brainstormform', entry });
  const second = mergeJsonSection(first.text, { section: 'mcpServers', key: 'brainstormform', entry });
  assert.equal(second.changed, false);

  const bad = mergeJsonSection('{ not json', { section: 'mcpServers', key: 'brainstormform', entry });
  assert.equal(bad.changed, false);
  assert.match(bad.error, /valid JSON/);
  assert.equal(bad.text, '{ not json');
});

test('mergeCodexToml appends, preserves and replaces a block', () => {
  const appended = mergeCodexToml('model = "gpt-5"\n', { binPath: BIN, nodePath: NODE });
  assert.match(appended.text, /model = "gpt-5"/);
  assert.match(appended.text, /\[mcp_servers\.brainstormform\]/);
  assert.match(appended.text, new RegExp(`args = \\["${BIN}", "mcp"\\]`));

  const replaced = mergeCodexToml(
    appended.text + '\n[other]\nkey = 1\n',
    { binPath: BIN, nodePath: NODE },
  );
  const count = (replaced.text.match(/\[mcp_servers\.brainstormform\]/g) || []).length;
  assert.equal(count, 1);
  assert.match(replaced.text, /\[other\]/);
});

test('detectAgents reports what exists under a home', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'bf-agents-'));
  const configHome = path.join(home, '.config');
  await fsp.mkdir(path.join(home, '.claude'), { recursive: true });
  await fsp.mkdir(path.join(configHome, 'opencode'), { recursive: true });
  try {
    const agents = detectAgents({ home, configHome });
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    assert.equal(byId.claude.detected, true);
    assert.equal(byId.opencode.detected, true);
    assert.equal(byId.codex.detected, false);
    assert.equal(byId.claude.configPath, path.join(home, '.claude.json'));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('applyConfig routes by strategy', () => {
  const codex = detectAgents({ home: '/nonexistent' }).find((a) => a.id === 'codex');
  const toml = applyConfig(codex, '', BIN, NODE);
  assert.match(toml.text, /mcp_servers\.brainstormform/);

  const opencode = detectAgents({ home: '/nonexistent' }).find((a) => a.id === 'opencode');
  const json = applyConfig(opencode, '', BIN, NODE);
  assert.equal(JSON.parse(json.text).mcp.brainstormform.type, 'local');
});
