import { describe, expect, rs, test } from '@rstest/core';
import {
  type CheckCommand,
  type CheckCommandResult,
  decide,
  deny,
  formatOutput,
  parseInput,
} from '../src/hook.ts';

const CWD = '/fallback/cwd';
const hookJson = (input: unknown): string => JSON.stringify(input);
const fakeCheck = (result: CheckCommandResult) => rs.fn<CheckCommand>(() => result);

describe('parseInput', () => {
  test('extracts the command and uses the fallback cwd', () => {
    expect(parseInput(hookJson({ tool_input: { command: 'ls -la' } }), CWD)).toEqual({
      command: 'ls -la',
      cwd: CWD,
    });
  });

  test('prefers cwd from the hook input when present', () => {
    expect(parseInput(hookJson({ cwd: '/project', tool_input: { command: 'ls' } }), CWD)).toEqual({
      command: 'ls',
      cwd: '/project',
    });
  });

  test('ignores an empty or non-string cwd', () => {
    expect(parseInput(hookJson({ cwd: '', tool_input: { command: 'ls' } }), CWD)?.cwd).toBe(CWD);
    expect(parseInput(hookJson({ cwd: 42, tool_input: { command: 'ls' } }), CWD)?.cwd).toBe(CWD);
  });

  test('preserves the command verbatim (no trimming)', () => {
    expect(parseInput(hookJson({ tool_input: { command: '  echo hi  ' } }), CWD)?.command).toBe(
      '  echo hi  ',
    );
  });

  test.each([
    ['empty string', ''],
    ['not JSON', 'garbage'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON string', '"rm -rf /"'],
    ['empty object', '{}'],
    ['tool_input not an object', hookJson({ tool_input: 'rm -rf /' })],
    ['tool_input is an array', hookJson({ tool_input: ['rm -rf /'] })],
    ['missing command', hookJson({ tool_input: {} })],
    ['non-string command', hookJson({ tool_input: { command: 123 } })],
    ['empty command', hookJson({ tool_input: { command: '' } })],
    ['whitespace command', hookJson({ tool_input: { command: ' \n\t ' } })],
  ])('returns null for %s', (_label, raw) => {
    expect(parseInput(raw, CWD)).toBeNull();
  });
});

describe('decide', () => {
  test('allow verdict → null (silent allow)', () => {
    const check = fakeCheck({ kind: 'allow' });
    expect(decide(hookJson({ tool_input: { command: 'git status' } }), check, CWD)).toBeNull();
    expect(check).toHaveBeenCalledWith({ command: 'git status', cwd: CWD });
  });

  test('deny verdict → deny output with reason and rule id', () => {
    const check = fakeCheck({ kind: 'deny', reason: 'Too dangerous.', ruleId: 'rm.root' });
    expect(decide(hookJson({ tool_input: { command: 'rm -rf /' } }), check, CWD)).toEqual({
      approval: 'deny',
      additionalContext: 'cc-safety-net blocked this command: Too dangerous. (rule: rm.root)',
    });
  });

  test('deny verdict without rule id omits the rule note', () => {
    const check = fakeCheck({ kind: 'deny', reason: 'Nope.' });
    expect(decide(hookJson({ tool_input: { command: 'x' } }), check, CWD)?.additionalContext).toBe(
      'cc-safety-net blocked this command: Nope.',
    );
  });

  test('passes the hook-provided cwd to checkCommand', () => {
    const check = fakeCheck({ kind: 'allow' });
    decide(hookJson({ cwd: '/project', tool_input: { command: 'ls' } }), check, CWD);
    expect(check).toHaveBeenCalledWith({ command: 'ls', cwd: '/project' });
  });

  test('malformed input → fail-closed deny without calling checkCommand', () => {
    const check = fakeCheck({ kind: 'allow' });
    const out = decide('{}', check, CWD);
    expect(out?.approval).toBe('deny');
    expect(out?.additionalContext).toContain('no command string');
    expect(check).not.toHaveBeenCalled();
  });

  test('checkCommand throwing an Error → fail-closed deny with the message', () => {
    const check: CheckCommand = () => {
      throw new Error('parser exploded');
    };
    const out = decide(hookJson({ tool_input: { command: 'ls' } }), check, CWD);
    expect(out?.approval).toBe('deny');
    expect(out?.additionalContext).toContain('failed to analyse');
    expect(out?.additionalContext).toContain('parser exploded');
  });

  test('checkCommand throwing a non-Error → fail-closed deny', () => {
    const check: CheckCommand = () => {
      throw 'string thrown';
    };
    expect(decide(hookJson({ tool_input: { command: 'ls' } }), check, CWD)?.additionalContext).toContain(
      'string thrown',
    );
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['unknown kind', { kind: 'maybe' }],
    ['a string', 'allow'],
  ])('unrecognised verdict (%s) → fail-closed deny', (_label, verdict) => {
    const check = (() => verdict) as unknown as CheckCommand;
    const out = decide(hookJson({ tool_input: { command: 'ls' } }), check, CWD);
    expect(out?.approval).toBe('deny');
    expect(out?.additionalContext).toContain('unrecognised verdict');
  });
});

describe('formatOutput', () => {
  test('allow → empty string', () => {
    expect(formatOutput(null)).toBe('');
  });

  test('deny → one line of JSON', () => {
    const text = formatOutput(deny('because'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(text)).toEqual({ approval: 'deny', additionalContext: 'because' });
  });
});
