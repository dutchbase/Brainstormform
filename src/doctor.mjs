import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { detectAgents, binPaths } from './agents.mjs';
import { sessionsRoot, stateRoot, configRoot } from './session.mjs';

export function permissionsList() {
  const home = os.homedir();
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { path: sessionsRoot(), purpose: 'temporary session data, deleted as soon as the agent reads it' },
    { path: stateRoot(), purpose: 'optional archive of past brainstorms (only with --archive)' },
    { path: path.join(configRoot(), 'profile.json'), purpose: 'global user profile shared with every agent' },
    { path: path.join(home, '.agents', 'skills', 'brainstormform'), purpose: 'installed agent skill (setup only)' },
    { path: path.join(home, '.claude', 'skills', 'brainstormform'), purpose: 'installed Claude skill (setup only)' },
    { path: path.join(cfg, 'opencode', 'skills', 'brainstormform'), purpose: 'installed opencode skill (setup only)' },
    { path: path.join(home, '.claude.json'), purpose: 'MCP entry (setup only)' },
    { path: path.join(home, '.codex', 'config.toml'), purpose: 'MCP entry (setup only)' },
    { path: path.join(cfg, 'opencode', 'opencode.json'), purpose: 'MCP entry (setup only)' },
  ];
}

function mcpHandshake(binPath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [binPath, 'mcp'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ ok: false, detail: 'could not spawn the MCP server' });
      return;
    }
    let buf = '';
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* gone */
      }
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => finish(false, 'no response within 4s'), 4000);
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.result && msg.result.serverInfo) {
            finish(true, msg.result.serverInfo.name + ' ' + msg.result.serverInfo.version);
          }
        } catch {
          /* not a full message yet */
        }
      }
    });
    child.on('error', () => finish(false, 'could not start the MCP server'));
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n',
    );
  });
}

export async function runDoctor({ version } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 18 || (major === 18 && minor >= 17);
  add('node', nodeOk, process.version + (nodeOk ? '' : ' (need >= 18.17)'));

  const onPath = spawnSync('which', ['brainstormform'], { encoding: 'utf8' });
  add('cli-on-path', onPath.status === 0, onPath.status === 0 ? onPath.stdout.trim() : 'not on PATH (use npx or npm link)');

  const { binPath } = binPaths(import.meta.url);
  let binOk = false;
  try {
    await fsp.access(binPath, fs.constants.X_OK);
    binOk = true;
  } catch {
    /* not executable */
  }
  add('binary', binOk, binPath);

  for (const [name, dir] of [['runtime-dir', sessionsRoot()], ['state-dir', stateRoot()]]) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const probe = path.join(dir, '.doctor-probe');
      await fsp.writeFile(probe, 'ok');
      await fsp.rm(probe, { force: true });
      add(name, true, dir);
    } catch (err) {
      add(name, false, dir + ' (' + err.message + ')');
    }
  }

  for (const agent of detectAgents()) {
    if (!agent.detected) continue;
    if (!fs.existsSync(agent.configPath)) {
      add('agent:' + agent.id, true, agent.name + ' detected, no config yet');
      continue;
    }
    try {
      const text = await fsp.readFile(agent.configPath, 'utf8');
      if (agent.strategy === 'json') JSON.parse(text);
      add('agent:' + agent.id, true, agent.configPath);
    } catch (err) {
      add('agent:' + agent.id, false, agent.configPath + ' (' + err.message + ')');
    }
  }

  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const browser = spawnSync('which', [openCmd], { encoding: 'utf8' });
  add('browser', browser.status === 0, openCmd);

  const mcp = await mcpHandshake(binPath);
  add('mcp', mcp.ok, mcp.detail);

  return {
    ok: checks.every((c) => c.ok),
    version,
    node: process.version,
    checks,
    permissions: permissionsList(),
  };
}
