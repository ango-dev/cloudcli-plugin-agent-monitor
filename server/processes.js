// Process discovery: finds Claude Code CLI processes and the tool shells they run.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';

const COMMAND_TIMEOUT_MS = 5000;

const PS = fs.existsSync('/bin/ps') ? '/bin/ps' : 'ps';
const LSOF = fs.existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';

/**
 * Runs a command and resolves with its stdout. With `allowFailure`, a non-zero
 * exit still resolves with whatever was printed (lsof exits 1 when some of the
 * requested pids are gone, but reports the rest).
 */
function run(file, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        if (error && !(allowFailure && typeof stdout === 'string')) {
          reject(error);
          return;
        }
        resolve(stdout || '');
      },
    );
  });
}

/** Parses a `ps` elapsed time (`[[dd-]hh:]mm:ss`) into seconds. */
export function parseEtime(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(value).trim());
  if (!match) return null;
  const [, days = '0', hours = '0', minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/;

/**
 * Parses `ps -o pid=,ppid=,pgid=,stat=,etime=,pcpu=,rss=,args=` output.
 * `zombie` marks processes that have exited but not been collected by their parent.
 */
export function parsePsOutput(text, now = Date.now()) {
  const processes = [];
  for (const line of text.split('\n')) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const elapsed = parseEtime(match[5]);
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      zombie: match[4].startsWith('Z'),
      startedAt: elapsed === null ? null : now - elapsed * 1000,
      cpu: Number(match[6].replace(',', '.')),
      rssKb: Number(match[7]),
      args: match[8].trim(),
    });
  }
  return processes;
}

/** Parses `ps -o pid=,comm=` output into a pid to command-name map. */
export function parseCommOutput(text) {
  const names = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s(.*)$/.exec(line);
    if (match) names.set(Number(match[1]), match[2].trim());
  }
  return names;
}

function baseName(file) {
  return String(file).split(/[\\/]/).pop();
}

const CLAUDE_BINARIES = new Set(['claude', 'claude.exe']);

/**
 * True for a Claude Code CLI process: the native `claude` binary, or Node/Bun
 * running the npm package's JavaScript entry point.
 */
export function isClaudeProcess({ comm = '', args = '' }) {
  if (CLAUDE_BINARIES.has(baseName(comm.trim()))) return true;
  if (CLAUDE_BINARIES.has(baseName(args.split(/\s+/)[0] || ''))) return true;
  return /@anthropic-ai[\\/]claude-(?:code|agent-sdk)[\\/]cli\.m?js(?:\s|$)/.test(args);
}

/** True for the shell Claude Code wraps around a Bash tool command. */
export function isToolShell(args) {
  return /[\\/]shell-snapshots[\\/]snapshot-/.test(args);
}

/** Undoes the octal escapes macOS `ps` prints for control characters such as newlines (`\012`). */
export function decodePsEscapes(text) {
  return text.replace(/\\(0[0-3][0-7]|177)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

/**
 * Recovers the user-facing command from a Bash tool shell. Claude Code runs
 * `... && eval '<command>' < /dev/null && pwd -P >| <file>`, quoting single
 * quotes inside the command as '"'"' (or '\'').
 */
export function extractShellCommand(args) {
  const match = /\beval '((?:[^']|'"'"'|'\\'')*)'(?=\s*(?:<|&&|\|\||;|$))/.exec(args);
  if (!match) return decodePsEscapes(args);
  return decodePsEscapes(match[1].replace(/'"'"'/g, "'").replace(/'\\''/g, "'"));
}

/** Extracts a background task id from a `.../tasks/<id>.output` path. */
export function taskIdFromOutputPath(file) {
  const match = /[\\/]tasks[\\/]([A-Za-z0-9_-]+)\.output$/.exec(file || '');
  return match ? match[1] : null;
}

/** Extracts the session id from `--resume <id>` or `--session-id <id>`. */
export function sessionIdFromArgs(args) {
  const match = /(?:^|\s)(?:--resume|-r|--session-id)(?:\s+|=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/i.exec(args);
  return match ? match[1] : null;
}

/** Lists every process with its parent, group, state, start time, usage and command line. */
export async function listProcesses(now = Date.now()) {
  const [table, comm] = await Promise.all([
    run(PS, ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,stat=,etime=,pcpu=,rss=,args=']).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error('`ps` was not found. Agent Monitor needs it to list processes; on Debian or Ubuntu, install the procps package.');
      }
      throw error;
    }),
    run(PS, ['-A', '-o', 'pid=,comm=']).catch(() => ''),
  ]);
  const names = parseCommOutput(comm);
  return parsePsOutput(table, now).map((proc) => ({ ...proc, comm: names.get(proc.pid) || '' }));
}

/** Parses `lsof -F` output (`p<pid>` then `n<name>` lines) into a pid to name map. */
export function parseLsofNames(text) {
  const names = new Map();
  let pid = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null && !names.has(pid)) names.set(pid, line.slice(1));
  }
  return names;
}

/** Resolves where each process's stdout points (a file, pipe or tty). */
export async function readStdoutTargets(pids, platform = process.platform) {
  if (!pids.length) return new Map();
  if (platform === 'linux') {
    const targets = new Map();
    for (const pid of pids) {
      try {
        targets.set(pid, fs.readlinkSync(`/proc/${pid}/fd/1`));
      } catch {
        // Gone, or not ours to inspect.
      }
    }
    return targets;
  }
  const out = await run(LSOF, ['-a', '-p', pids.join(','), '-d', '1', '-Fpn'], { allowFailure: true }).catch(() => '');
  return parseLsofNames(out);
}

/** Resolves a process's working directory. Only used when Claude Code left no session file. */
export async function readCwd(pid, platform = process.platform) {
  if (platform === 'linux') {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  const out = await run(LSOF, ['-a', '-p', String(pid), '-d', 'cwd', '-Fpn'], { allowFailure: true }).catch(() => '');
  return parseLsofNames(out).get(pid) ?? null;
}

/**
 * `ps` states of one process or of every process in a group, or null when
 * `ps` cannot be run.
 */
function readStates({ pid, pgid }) {
  let out;
  try {
    out = execFileSync(PS, ['-A', '-o', 'pid=,pgid=,stat='], {
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: 'C' },
    });
  } catch {
    return null;
  }
  const states = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
    if (!match) continue;
    if (Number(pid === undefined ? match[2] : match[1]) === (pid ?? pgid)) states.push(match[3]);
  }
  return states;
}

// A zombie has exited and only waits for its parent to collect it. Inside a
// container without an init process nobody may ever do that, so it counts as gone.
const running = (states) => states === null || states.some((state) => !state.startsWith('Z'));

/** True while the pid runs (EPERM means it exists but belongs to someone else). */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return false;
  }
  return running(readStates({ pid }));
}

/** True while any process in the group runs. */
export function isGroupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return false;
  }
  return running(readStates({ pgid }));
}
