import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pure config-merge helpers (unit-tested) plus a small registry of agents.

export function binPaths(metaUrl) {
  const dir = path.dirname(fileURLToPath(metaUrl));
  return { binPath: path.resolve(dir, '..', 'bin', 'brainstormform'), nodePath: process.execPath };
}

export function mcpCommand(binPath, nodePath) {
  return { command: nodePath, args: [binPath, 'mcp'] };
}

export function opencodeEntry(binPath, nodePath) {
  return { type: 'local', command: [nodePath, binPath, 'mcp'], enabled: true };
}

export function mergeJsonSection(text, { section, key, entry }) {
  let obj;
  try {
    obj = String(text || '').trim() ? JSON.parse(text) : {};
  } catch (err) {
    return { text, changed: false, error: 'existing file is not valid JSON: ' + err.message };
  }
  if (!obj[section] || typeof obj[section] !== 'object' || Array.isArray(obj[section])) obj[section] = {};
  const before = JSON.stringify(obj[section][key]);
  obj[section][key] = entry;
  return { text: JSON.stringify(obj, null, 2) + '\n', changed: before !== JSON.stringify(entry) };
}

export function mergeCodexToml(text, { binPath, nodePath }) {
  const block = [
    '[mcp_servers.brainstormform]',
    `command = ${JSON.stringify(nodePath)}`,
    `args = [${JSON.stringify(binPath)}, "mcp"]`,
  ];
  const source = String(text || '');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[mcp_servers.brainstormform]');

  if (start === -1) {
    const trimmed = source.replace(/\s*$/, '');
    const joined = trimmed ? trimmed + '\n\n' + block.join('\n') + '\n' : block.join('\n') + '\n';
    return { text: joined, changed: true };
  }

  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const next = [...lines.slice(0, start), ...block, '', ...lines.slice(end)];
  const out = next.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  return { text: out, changed: true };
}

export function skillDirs(home, configHome) {
  return {
    shared: path.join(home, '.agents', 'skills'),
    claude: path.join(home, '.claude', 'skills'),
    opencode: path.join(configHome, 'opencode', 'skills'),
  };
}

export function detectAgents({ home = os.homedir(), configHome } = {}) {
  const cfg = configHome || process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const dirs = skillDirs(home, cfg);
  const exists = (p) => fs.existsSync(p);

  return [
    {
      id: 'claude',
      name: 'Claude Code',
      strategy: 'json',
      detected: exists(path.join(home, '.claude')),
      configPath: path.join(home, '.claude.json'),
      section: 'mcpServers',
      key: 'brainstormform',
      skillDir: dirs.claude,
      mcpConfig: 'claude mcp add brainstormform -- node <bin> mcp',
    },
    {
      id: 'codex',
      name: 'Codex',
      strategy: 'toml',
      detected: exists(path.join(home, '.codex')),
      configPath: path.join(home, '.codex', 'config.toml'),
      skillDir: dirs.shared,
      mcpConfig: '[mcp_servers.brainstormform] in ~/.codex/config.toml',
    },
    {
      id: 'opencode',
      name: 'opencode',
      strategy: 'json',
      detected: exists(path.join(cfg, 'opencode')),
      configPath: path.join(cfg, 'opencode', 'opencode.json'),
      section: 'mcp',
      key: 'brainstormform',
      skillDir: dirs.opencode,
      mcpConfig: 'the "mcp" block in opencode.json',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      strategy: 'json',
      detected: exists(path.join(home, '.cursor')),
      configPath: path.join(home, '.cursor', 'mcp.json'),
      section: 'mcpServers',
      key: 'brainstormform',
      skillDir: dirs.shared,
      mcpConfig: 'mcpServers in ~/.cursor/mcp.json',
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      strategy: 'json',
      detected: exists(path.join(home, '.gemini')),
      configPath: path.join(home, '.gemini', 'settings.json'),
      section: 'mcpServers',
      key: 'brainstormform',
      skillDir: dirs.shared,
      mcpConfig: 'mcpServers in ~/.gemini/settings.json',
    },
  ];
}

export function mcpEntryFor(agent, binPath, nodePath) {
  if (agent.id === 'opencode') return opencodeEntry(binPath, nodePath);
  const { command, args } = mcpCommand(binPath, nodePath);
  return { command, args };
}

export function applyConfig(agent, existingText, binPath, nodePath) {
  if (agent.strategy === 'toml') return mergeCodexToml(existingText, { binPath, nodePath });
  return mergeJsonSection(existingText, {
    section: agent.section,
    key: agent.key,
    entry: mcpEntryFor(agent, binPath, nodePath),
  });
}
