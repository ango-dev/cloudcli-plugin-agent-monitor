// Stands in for a Claude Code process: registers its session the way Claude Code does
// and runs Bash tool shells in the same shape as the real ones.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const config = JSON.parse(process.env.DEMO_SESSION);
const home = process.env.HOME;
const sessionFile = `${home}/.claude/sessions/${process.pid}.json`;
fs.mkdirSync(`${home}/.claude/sessions`, { recursive: true });
fs.writeFileSync(sessionFile, JSON.stringify({
  pid: process.pid,
  sessionId: config.sessionId,
  cwd: config.cwd,
  startedAt: Date.now(),
  version: '2.1.280',
  kind: 'interactive',
  entrypoint: config.entrypoint,
  status: 'busy',
}));

const shells = [];
for (const shell of config.shells || []) {
  setTimeout(() => {
    const tasks = `/tmp/claude-${process.getuid()}/${config.cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${config.sessionId}/tasks`;
    fs.mkdirSync(tasks, { recursive: true });
    const out = fs.openSync(`${tasks}/${shell.taskId}.output`, 'a');
    const quoted = shell.command.replace(/'/g, `'"'"'`);
    // The stub turns the demo command into a long sleep; the eval keeps Claude Code's shape.
    const script = `source ${home}/.claude/shell-snapshots/snapshot-bash-1790000000000-demo.sh 2>/dev/null || true; ${shell.stub}; eval '${quoted}' < /dev/null && pwd -P >| /tmp/claude-demo-cwd`;
    const child = spawn('/bin/bash', ['-c', script], { cwd: config.cwd, detached: true, stdio: ['ignore', out, out] });
    shells.push(child.pid);
  }, shell.delayMs);
}

const stop = () => {
  for (const pid of shells) {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
  }
  try { fs.unlinkSync(sessionFile); } catch {}
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => {}, 60_000);
