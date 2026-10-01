// Stops a Claude Code process or one of its tool shells, escalating to SIGKILL.

import * as procs from './processes.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

/** Sends a signal; false when the target no longer exists. */
function send(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * SIGTERM, then SIGKILL if the target is still there after `graceMs`. With a
 * process group id the whole group is signalled and waited for.
 */
export async function terminate({ pid = null, pgid = null }, graceMs) {
  const target = pgid ? -pgid : pid;
  const alive = () => (pgid ? procs.isGroupAlive(pgid) : procs.isAlive(pid));
  if (!send(target, 'SIGTERM')) return { signal: null, exited: true };
  if (await waitFor(() => !alive(), graceMs)) return { signal: 'SIGTERM', exited: true };
  send(target, 'SIGKILL');
  return { signal: 'SIGKILL', exited: await waitFor(() => !alive(), 2000) };
}

/**
 * Stops `{ kind, pid }` after checking it against a fresh process list:
 * `process` must be a Claude Code process, `shell` a tool shell whose parent
 * is one. Stopping a process also stops tool shells it leaves behind.
 */
export async function stopTarget(
  { kind, pid },
  { listProcesses = procs.listProcesses, graceMs = 5000, protectedPids = [process.pid, process.ppid] } = {},
) {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, code: 'invalid', error: 'Invalid pid' };
  if (protectedPids.includes(pid)) return { ok: false, code: 'protected', error: 'Refusing to stop this process' };

  const all = await listProcesses();
  const byPid = new Map(all.map((proc) => [proc.pid, proc]));
  const target = byPid.get(pid);
  if (!target) return { ok: false, code: 'not_found', error: 'The process is no longer running' };

  if (kind === 'process') {
    if (!procs.isClaudeProcess(target)) return { ok: false, code: 'rejected', error: 'Not a Claude Code process' };
    const shellGroups = all
      .filter((proc) => proc.ppid === pid && procs.isToolShell(proc.args) && proc.pgid === proc.pid)
      .map((proc) => proc.pgid);
    const result = await terminate({ pid }, graceMs);
    let shellsStopped = 0;
    for (const pgid of shellGroups) {
      if (!procs.isGroupAlive(pgid)) continue;
      await terminate({ pgid }, 2000);
      shellsStopped += 1;
    }
    return { ok: result.exited, kind, pid, signal: result.signal, exited: result.exited, shellsStopped };
  }

  if (kind === 'shell') {
    const parent = byPid.get(target.ppid);
    if (!procs.isToolShell(target.args) || !parent || !procs.isClaudeProcess(parent)) {
      return { ok: false, code: 'rejected', error: 'Not a Claude Code tool shell' };
    }
    // The shell leads its own process group, so its command's children go too.
    const result = await terminate(target.pgid === target.pid ? { pgid: target.pgid } : { pid }, graceMs);
    return { ok: result.exited, kind, pid, signal: result.signal, exited: result.exited };
  }

  return { ok: false, code: 'invalid', error: 'Unknown target kind' };
}
