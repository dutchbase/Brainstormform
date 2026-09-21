#!/usr/bin/env sh
# Install Brainstormform. Requires Node.js 18.17+.
#
#   curl -fsSL https://raw.githubusercontent.com/dutchbase/Brainstormform/main/install.sh | sh
#
# Override the source with BRAINSTORMFORM_PACKAGE (any npm-installable spec).
set -eu

REPO="${BRAINSTORMFORM_REPO:-dutchbase/Brainstormform}"
PKG="${BRAINSTORMFORM_PACKAGE:-github:$REPO}"

err() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || err "Node.js 18.17+ is required (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || err "npm is required (it ships with Node.js)"

MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 18 ] || { [ "$MAJOR" -eq 18 ] && [ "$MINOR" -lt 17 ]; }; then
  err "Node.js 18.17+ is required (found $(node -v))"
fi

printf 'Installing brainstormform from %s ...\n' "$PKG"
npm install -g "$PKG"

if command -v brainstormform >/dev/null 2>&1; then
  printf 'Installed brainstormform %s\n\n' "$(brainstormform version)"
  printf 'Next: run "brainstormform setup" to wire up Claude Code, Codex and opencode.\n'
else
  err "installed, but 'brainstormform' is not on your PATH. Check your npm global bin directory (npm prefix -g)."
fi
