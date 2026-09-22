// Flag-aware argument parser shared by the CLI and the session server.
//
// Only flags listed in `valueFlags` (or written as --key=value) consume the
// next token. Everything else is treated as a boolean, so a flag placed before
// a positional cannot silently swallow it.
export const VALUE_FLAGS = new Set([
  'out',
  'to',
  'target',
  'dir',
  'timeout',
  'on-submit',
  'idle-timeout',
  'max-upload',
  'session',
  'format',
  'since',
  'from',
  'preset',
]);

export function parseArgs(argv, { valueFlags = VALUE_FLAGS } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    if (valueFlags.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      out[key] = argv[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}
