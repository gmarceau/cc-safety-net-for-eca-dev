// Pure ECA preToolCall hook logic — no I/O, so it can be unit-tested directly.
//
// ECA hook protocol:
//   - stdin: JSON with the shell command at `tool_input.command`
//   - allow: exit 0 with no output (ECA's own approval flow continues)
//   - deny:  exit 0 with { "approval": "deny", "additionalContext": "..." }
//
// Security model: fail-closed. Anything unexpected becomes a deny, never an allow.

export interface CheckCommandInput {
  readonly command: string;
  readonly cwd: string;
}

export type CheckCommandResult =
  | Readonly<{ kind: 'allow' }>
  | Readonly<{ kind: 'deny'; reason: string; ruleId?: string }>;

export type CheckCommand = (input: CheckCommandInput) => CheckCommandResult;

export interface DenyOutput {
  approval: 'deny';
  additionalContext: string;
}

/** `null` means allow (print nothing); otherwise the deny JSON to print. */
export type HookOutput = DenyOutput | null;

export interface ParsedInput {
  command: string;
  cwd: string;
}

export function deny(additionalContext: string): DenyOutput {
  return { approval: 'deny', additionalContext };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract the command and cwd from the raw hook stdin.
 * Returns `null` if there is no usable command string.
 * ECA does not currently send `cwd`; it spawns hooks from the workspace root,
 * so `fallbackCwd` (normally `process.cwd()`) is the project directory.
 */
export function parseInput(raw: string, fallbackCwd: string): ParsedInput | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const toolInput = data['tool_input'];
  const command = isRecord(toolInput) ? toolInput['command'] : undefined;
  if (typeof command !== 'string' || command.trim() === '') return null;

  const cwd = typeof data['cwd'] === 'string' && data['cwd'] !== '' ? data['cwd'] : fallbackCwd;
  return { command, cwd };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Decide what the hook should output for the given raw stdin. Never throws. */
export function decide(raw: string, checkCommand: CheckCommand, fallbackCwd: string): HookOutput {
  const parsed = parseInput(raw, fallbackCwd);
  if (parsed === null) {
    return deny('cc-safety-net: hook received no command string — blocked as a precaution.');
  }

  let result: CheckCommandResult;
  try {
    result = checkCommand(parsed);
  } catch (err) {
    return deny(
      `cc-safety-net failed to analyse this command — blocked as a precaution. (${errorMessage(err)})`,
    );
  }

  if (isRecord(result) && result.kind === 'allow') return null;

  if (isRecord(result) && result.kind === 'deny') {
    const ruleNote = result.ruleId ? ` (rule: ${result.ruleId})` : '';
    return deny(`cc-safety-net blocked this command: ${result.reason}${ruleNote}`);
  }

  // Unknown verdict shape → fail closed.
  return deny('cc-safety-net returned an unrecognised verdict — blocked as a precaution.');
}

/** Serialise a hook output for stdout ('' for allow). */
export function formatOutput(output: HookOutput): string {
  return output === null ? '' : JSON.stringify(output) + '\n';
}
