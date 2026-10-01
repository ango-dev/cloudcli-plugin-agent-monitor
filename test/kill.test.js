import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { stopTarget } from '../server/kill.js';
import { isAlive, isGroupAlive } from '../server/processes.js';

const skip = process.platform === 'win32' ? 'needs POSIX signals and ps' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-kill-'));
const script = path.join(tmp, 'fake-claude.mjs');

// Stands in for the Claude Code CLI: named `claude`, running one detached tool shell.
fs.writeFileSync(
  script,
  `import { spawn } from 'node:child_process';
const marker = ${JSON.stringify(path.join(tmp, 'shell-snapshots', 'snapshot-zsh-test.sh'))};
const shell = spawn('/bin/sh', ['-c', ': ' + marker + "; eval 'sleep 60' < /dev/null; echo done"], { detached: true, stdio: 'ignore' });
if (process.env.IGNORE_TERM) process.on('SIGTERM', () => {});
process.stdout.write(JSON.stringify({ shell: shell.pid }) + '\\n');
setInterval(() => {}, 1000);
`,
);

const started = [];
after(() => {
  for (const pid of started) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function startFakeClaude(env = {}) {
  const child = spawn(process.execPath, [script], { argv0: 'claude', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(String(data)));
    child.once('error', reject);
  });
  const { shell } = JSON.parse(line);
  started.push(child.pid, shell);
  return { child, pid: child.pid, shell };
}

const waitUntil = async (check, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

test('stopping a process also stops the tool shells it leaves behind', { skip }, async () => {
  const { pid, shell } = await startFakeClaude();
  const result = await stopTarget({ kind: 'process', pid }, { graceMs: 3000 });
  assert.deepEqual(result, { ok: true, kind: 'process', pid, signal: 'SIGTERM', exited: true, shellsStopped: 1 });
  assert.equal(isAlive(pid), false);
  assert.equal(await waitUntil(() => !isGroupAlive(shell)), true);
});

test('a process that ignores SIGTERM is killed', { skip }, async () => {
  const { pid } = await startFakeClaude({ IGNORE_TERM: '1' });
  // Give the fake time to install its SIGTERM handler.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = await stopTarget({ kind: 'process', pid }, { graceMs: 300 });
  assert.equal(result.ok, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(isAlive(pid), false);
});

test('stopping a shell stops its whole process group and leaves Claude running', { skip }, async () => {
  const { pid, shell } = await startFakeClaude();
  const result = await stopTarget({ kind: 'shell', pid: shell }, { graceMs: 3000 });
  assert.deepEqual(result, { ok: true, kind: 'shell', pid: shell, signal: 'SIGTERM', exited: true });
  assert.equal(isGroupAlive(shell), false);
  assert.equal(isAlive(pid), true);
  process.kill(pid, 'SIGKILL');
});

test('a zombie counts as exited', { skip }, async () => {
  // The background sleep exits first; its parent then execs into a sleep that never collects it.
  const parent = spawn('/bin/sh', ['-c', 'sleep 0.2 & echo $!; exec sleep 30'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  started.push(parent.pid);
  const zombie = Number(await new Promise((resolve) => parent.stdout.once('data', (data) => resolve(String(data).trim()))));
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.doesNotThrow(() => process.kill(zombie, 0), 'the zombie still has a process table entry');
  assert.equal(isAlive(zombie), false);
  assert.equal(isAlive(parent.pid), true);
  assert.equal(isGroupAlive(parent.pid), true);
  process.kill(parent.pid, 'SIGKILL');
  assert.equal(await waitUntil(() => !isGroupAlive(parent.pid)), true);
});

test('targets are checked against what is actually running', { skip }, async () => {
  const { pid, shell } = await startFakeClaude();
  assert.equal((await stopTarget({ kind: 'process', pid: shell })).code, 'rejected');
  assert.equal((await stopTarget({ kind: 'shell', pid })).code, 'rejected');
  assert.equal((await stopTarget({ kind: 'nonsense', pid })).code, 'invalid');
  assert.equal((await stopTarget({ kind: 'process', pid: process.pid })).code, 'protected');
  assert.equal((await stopTarget({ kind: 'process', pid: Number('abc') })).code, 'invalid');
  assert.equal((await stopTarget({ kind: 'process', pid: 1 })).code, 'invalid');
  assert.equal((await stopTarget({ kind: 'process', pid: 2 ** 22 + 12345 })).code, 'not_found');
  assert.equal(isAlive(pid), true);
  assert.equal(isAlive(shell), true);
});
