import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectAgents, applyConfig, binPaths, skillDirs } from './agents.mjs';
import { runDoctor } from './doctor.mjs';
import { VERSION } from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(__dirname, '..', 'skills', 'brainstormform', 'SKILL.md');

async function installSkillTo(dir, actions) {
  const dest = path.join(dir, 'brainstormform', 'SKILL.md');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(SKILL_SRC, dest);
  actions.push({ action: 'skill', path: dest });
}

async function writeConfig(agent, binPath, nodePath, actions) {
  const existing = fs.existsSync(agent.configPath) ? await fsp.readFile(agent.configPath, 'utf8') : '';
  const result = applyConfig(agent, existing, binPath, nodePath);
  if (result.error) {
    actions.push({ action: 'mcp-skipped', agent: agent.id, path: agent.configPath, reason: result.error });
    return;
  }
  if (!result.changed) {
    actions.push({ action: 'mcp', agent: agent.id, path: agent.configPath, changed: false });
    return;
  }
  if (existing) {
    const backup = agent.configPath + '.bak-' + Date.now();
    await fsp.copyFile(agent.configPath, backup);
    actions.push({ action: 'backup', path: backup });
  }
  await fsp.mkdir(path.dirname(agent.configPath), { recursive: true });
  await fsp.writeFile(agent.configPath, result.text);
  actions.push({ action: 'mcp', agent: agent.id, path: agent.configPath, changed: true });
}

function configureClaude(binPath, actions) {
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
  if (which.status !== 0) {
    actions.push({
      action: 'mcp-skipped',
      agent: 'claude',
      reason: 'claude CLI not found; run: claude mcp add brainstormform -- node ' + binPath + ' mcp',
    });
    return;
  }
  const cli = which.stdout.trim();
  const run = spawnSync(cli, ['mcp', 'add', 'brainstormform', '-s', 'user', '--', process.execPath, binPath, 'mcp'], {
    encoding: 'utf8',
  });
  if (run.status === 0) actions.push({ action: 'mcp', agent: 'claude', path: 'user scope', changed: true });
  else actions.push({ action: 'mcp-skipped', agent: 'claude', reason: (run.stderr || run.stdout || 'claude mcp add failed').trim() });
}

export async function runSetup({ yes = false, targets, log = () => {} } = {}) {
  const home = os.homedir();
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const { binPath, nodePath } = binPaths(import.meta.url);
  const agents = detectAgents({ home, configHome });
  const detected = agents.filter((a) => a.detected);
  let chosen = targets && targets.length ? agents.filter((a) => targets.includes(a.id)) : detected;

  const interactive = !yes && process.stdin.isTTY && process.stdout.isTTY && !targets;
  let rl = null;
  if (interactive) {
    rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    if (chosen.length) {
      const answer = (await rl.question(`Configure ${chosen.map((a) => a.name).join(', ')}? [Y/n] `)).trim().toLowerCase();
      if (answer === 'n' || answer === 'no') chosen = [];
    } else {
      log('No supported agents detected automatically.');
    }
  }

  const actions = [];
  const dirs = skillDirs(home, configHome);

  if (chosen.length) {
    await installSkillTo(dirs.shared, actions);
    if (chosen.some((a) => a.id === 'opencode')) await installSkillTo(dirs.opencode, actions);
    if (chosen.some((a) => a.id === 'claude')) await installSkillTo(dirs.claude, actions);
  }

  for (const agent of chosen) {
    log('Configuring ' + agent.name + '...');
    if (agent.id === 'claude') configureClaude(binPath, actions);
    else await writeConfig(agent, binPath, nodePath, actions);
  }

  if (rl) rl.close();

  const doctor = await runDoctor({ version: VERSION });
  return {
    version: VERSION,
    detected: detected.map((a) => a.id),
    configured: chosen.map((a) => a.id),
    actions,
    doctor,
  };
}
