// End-to-end: drive run.sh exactly as ECA does (JSON on stdin, through the shell).
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from '@rstest/core';

const ROOT = process.cwd();
const RUN_SH = path.join(ROOT, 'run.sh');

function runHook(stdin: string) {
  const res = spawnSync('/bin/sh', ['-c', `"${RUN_SH}"`], {
    input: stdin,
    cwd: tmpdir(), // like ECA: spawned from some other directory
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('run.sh (end-to-end)', () => {
  test('safe command → exit 0, no output', () => {
    const res = runHook(JSON.stringify({ tool_input: { command: 'git status' } }));
    expect(res).toEqual({ status: 0, stdout: '', stderr: '' });
  });

  test('destructive command → exit 0 with deny JSON', () => {
    const res = runHook(JSON.stringify({ tool_input: { command: 'bash -c "rm -rf ~"' } }));
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toEqual({
      approval: 'deny',
      additionalContext: expect.stringContaining('rule: rm.recursive-force-root-or-home'),
    });
  });

  test.each(['{}', 'garbage', ''])('malformed stdin %j → fail-closed deny', (stdin) => {
    const res = runHook(stdin);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).approval).toBe('deny');
  });
});
