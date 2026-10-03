// ECA preToolCall hook entry point, run directly by Node (type stripping) via run.sh.
import { readFileSync } from 'node:fs';
import { decide, deny, formatOutput, type CheckCommand, type HookOutput } from './hook.ts';
import { loadCheckCommand } from './load.ts';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<HookOutput> {
  let checkCommand: CheckCommand;
  try {
    checkCommand = await loadCheckCommand();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deny(`cc-safety-net could not be loaded — blocked as a precaution. (${message})`);
  }

  return decide(readStdin(), checkCommand, process.cwd());
}

process.stdout.write(formatOutput(await main()));
process.exitCode = 0;
