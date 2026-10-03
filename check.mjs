#!/usr/bin/env node
// ECA preToolCall hook — delegates shell command safety decisions to cc-safety-net.
//
// ECA pipes a JSON object to stdin with at minimum:
//   { "tool_input": { "command": "<shell command>" }, ... }
//
// This script:
//   - ALLOW → exits 0 with no output (ECA keeps its own approval logic)
//   - DENY  → exits 0 with JSON { "approval": "deny", "additionalContext": "..." }
//             so the LLM receives an explanation and can suggest a safe alternative
//   - THROW → same deny JSON, fail-closed (a check failure is never an allow)

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Resolve checkCommand relative to this script's own node_modules,
// so the hook works regardless of the process working directory.
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// Dynamic import so we can catch resolution errors cleanly.
let checkCommand;
try {
  const mod = await import(
    resolve(__dirname, 'node_modules/cc-safety-net/dist/api.js')
  );
  checkCommand = mod.checkCommand;
} catch (err) {
  // If the package can't be loaded, fail closed.
  process.stdout.write(JSON.stringify({
    approval: 'deny',
    additionalContext:
      `cc-safety-net could not be loaded — blocked as a precaution. (${err.message})`,
  }) + '\n');
  process.exit(0);
}

// Read stdin.
let raw = '';
try {
  raw = readFileSync('/dev/stdin', 'utf8');
} catch {
  raw = '';
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  input = {};
}

const command = input?.tool_input?.command;
// ECA does not currently pass cwd in hook JSON, so use process.cwd().
// ECA spawns hooks from the workspace root, so this is the project directory.
const cwd = (typeof input?.cwd === 'string' && input.cwd) ? input.cwd : process.cwd();

// Malformed input: no command string → fail closed.
if (typeof command !== 'string' || command.trim() === '') {
  process.stdout.write(JSON.stringify({
    approval: 'deny',
    additionalContext:
      'cc-safety-net: hook received no command string — blocked as a precaution.',
  }) + '\n');
  process.exit(0);
}

try {
  const result = checkCommand({ command, cwd });

  if (result.kind === 'allow') {
    // Silent allow — ECA will proceed with its own approval prompt.
    process.exit(0);
  }

  // Deny: surface the reason and rule id to the LLM.
  const ruleNote = result.ruleId ? ` (rule: ${result.ruleId})` : '';
  process.stdout.write(JSON.stringify({
    approval: 'deny',
    additionalContext: `cc-safety-net blocked this command: ${result.reason}${ruleNote}`,
  }) + '\n');
  process.exit(0);

} catch (err) {
  // Unexpected error from checkCommand → fail closed.
  process.stdout.write(JSON.stringify({
    approval: 'deny',
    additionalContext:
      `cc-safety-net failed to analyse this command — blocked as a precaution. (${err.message})`,
  }) + '\n');
  process.exit(0);
}
