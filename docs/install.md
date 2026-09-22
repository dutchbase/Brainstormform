# Install

Brainstormform is a Node CLI plus an MCP server. Node 18.17 or newer is the only
requirement.

## One command

```bash
curl -fsSL https://raw.githubusercontent.com/dutchbase/Brainstormform/main/install.sh | sh
```

The script checks your Node version and installs the CLI globally. Then wire up
your agents:

```bash
brainstormform setup
```

## Other ways

```bash
# zero install, always current
npx -y github:dutchbase/Brainstormform ask questions.json --open

# global install
npm install -g github:dutchbase/Brainstormform

# from a checkout
git clone https://github.com/dutchbase/Brainstormform
cd Brainstormform && npm link
```

Once the package is on npm you will be able to use `npx brainstormform` and
`npm install -g brainstormform`.

## `brainstormform setup`

An interactive wizard that detects the agents on your machine and wires
Brainstormform in:

- installs the skills so the agent knows when to use it — the Brainstormform
  skill plus the bundled superpowers `brainstorming` skill (skipped when a copy
  is already installed),
- writes the MCP entry for each detected agent (Claude Code, Codex, opencode,
  Cursor, Gemini CLI),
- runs `doctor` and prints anything that needs attention.

Flags for scripts and agents:

```bash
brainstormform setup --yes                       # no prompts
brainstormform setup --target opencode,codex     # only these
```

Existing config files are backed up to `<file>.bak-<timestamp>` before any edit.

## Per-agent wiring

If you prefer to do it by hand:

**Claude Code**

```bash
claude mcp add brainstormform -- node /abs/path/to/bin/brainstormform mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.brainstormform]
command = "node"
args = ["/abs/path/to/bin/brainstormform", "mcp"]
```

**opencode** (`opencode.json`)

```json
{
  "mcp": {
    "brainstormform": {
      "type": "local",
      "command": ["node", "/abs/path/to/bin/brainstormform", "mcp"],
      "enabled": true
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`) and **Gemini CLI** (`~/.gemini/settings.json`)
use the same `mcpServers` shape:

```json
{
  "mcpServers": {
    "brainstormform": {
      "command": "node",
      "args": ["/abs/path/to/bin/brainstormform", "mcp"]
    }
  }
}
```

Restart the agent afterwards so it picks up the MCP server and the skill.

## Verify

```bash
brainstormform doctor           # human-readable
brainstormform doctor --json    # machine-readable
```

Checks Node, `brainstormform` on PATH, writable data dirs, agent configs, a live
MCP handshake, and a browser opener. It also prints the exact paths the tool can
touch.

## What it touches on disk

- `$XDG_RUNTIME_DIR/brainstormform/` — temporary session data, deleted as soon as
  the agent reads it.
- `$XDG_STATE_HOME/brainstormform/` — optional archive, only with `--archive`.
- `$XDG_CONFIG_HOME/brainstormform/profile.json` — your [user profile](profile.md),
  written only when you save one from the settings menu or the onboarding form.
- Agent config files and skill folders — only when you run `setup`.
- `.brainstormform/` in the current directory — only with `ask --out`.

No telemetry, no network calls, nothing leaves the machine.

## Update / uninstall

```bash
brainstormform update           # npm-based self-update
brainstormform update --check   # just report

npm uninstall -g brainstormform
rm -rf ~/.agents/skills/brainstormform ~/.agents/skills/brainstorming \
       ~/.claude/skills/brainstormform ~/.claude/skills/brainstorming
```

## Troubleshooting

- **`brainstormform: command not found`** — the npm global bin directory is not
  on your PATH. Check `npm prefix -g` and add its `bin` to PATH, or use `npx`.
- **`doctor` says the MCP server failed** — run `node /abs/path/to/bin/brainstormform mcp`
  and send `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}` to see the error.
- **The browser does not open** — the tool always prints the URL; copy it
  manually. On headless machines there is no browser to open.
- **The agent never uses Brainstormform** — install the skill
  (`brainstormform install-skill`) and restart the agent.
