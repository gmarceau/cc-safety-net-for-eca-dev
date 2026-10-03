import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, test } from '@rstest/core';
import { type CheckCommand, decide } from '../src/hook.ts';
import { loadCheckCommand } from '../src/load.ts';

const hookJson = (command: string): string => JSON.stringify({ tool_input: { command } });

describe('loadCheckCommand', () => {
  test('loads the real checkCommand from cc-safety-net/api', async () => {
    expect(typeof (await loadCheckCommand())).toBe('function');
  });

  test('rejects when the module cannot be imported', async () => {
    await expect(loadCheckCommand(() => Promise.reject(new Error('Cannot find package')))).rejects.toThrow(
      'Cannot find package',
    );
  });

  test.each([
    ['no checkCommand export', { somethingElse: 1 }],
    ['non-function checkCommand', { checkCommand: 'nope' }],
    ['null module', null],
  ])('rejects on %s', async (_label, mod) => {
    await expect(loadCheckCommand(async () => mod)).rejects.toThrow(/checkCommand export not found/);
  });
});

// Integration: the pure logic wired to the real cc-safety-net engine.
describe('decide with real cc-safety-net', () => {
  let check: CheckCommand;
  const cwd = tmpdir();

  beforeAll(async () => {
    check = await loadCheckCommand();
  });

  test.each(['git status', 'ls -la', 'echo hello', 'npm test'])('allows %s', (command) => {
    expect(decide(hookJson(command), check, cwd)).toBeNull();
  });

  test.each([
    ['rm -rf /', 'rm -rf /'],
    ['rm -rf ~', 'rm -rf ~'],
    ['nested bash -c', 'bash -c "rm -rf ~"'],
    ['doubly nested sh -c', `sh -c "bash -c 'rm -rf ~'"`],
    ['AWS credentials', 'cat ~/.aws/credentials'],
    ['git rm --force', 'git rm -f somefile'],
  ])('denies %s', (_label, command) => {
    const out = decide(hookJson(command), check, cwd);
    expect(out?.approval).toBe('deny');
    expect(out?.additionalContext).toMatch(/^cc-safety-net blocked this command: .+ \(rule: [\w.-]+\)$/);
  });

  test('reports the specific rule for rm -rf ~ wrapped in bash -c', () => {
    expect(decide(hookJson('bash -c "rm -rf ~"'), check, cwd)?.additionalContext).toContain(
      'rule: rm.recursive-force-root-or-home',
    );
  });

  test('reports the secret rule for AWS credentials', () => {
    expect(decide(hookJson('cat ~/.aws/credentials'), check, cwd)?.additionalContext).toContain(
      'rule: secret.home.aws',
    );
  });

  test('relative cwd rejected by cc-safety-net → fail-closed deny', () => {
    const out = decide(JSON.stringify({ cwd: 'relative/dir', tool_input: { command: 'ls' } }), check, cwd);
    expect(out?.approval).toBe('deny');
    expect(out?.additionalContext).toContain('failed to analyse');
  });
});
