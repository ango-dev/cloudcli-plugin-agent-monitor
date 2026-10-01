import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { classifyOrigin, createCollector } from '../server/collect.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const HOST = 1000;
const P1 = { pid: 2001, start: NOW - 600_000 }; // superseded process, still running background work
const P2 = { pid: 2002, start: NOW - 120_000 }; // newest process of the session, mid-turn
const SESSION = '2c5e8a91-7b34-4f0d-9e62-a1d3b8c4f507';
const CWD = '/work/demo';
const SNAPSHOT = '/bin/zsh -c source /h/.claude/shell-snapshots/snapshot-zsh-1-x.sh 2>/dev/null || true && ';

const iso = (ms) => new Date(ms).toISOString();
const prompt = (text, ms) => ({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: text } });
const call = (msgId, id, name, input, ms) => ({
  type: 'assistant',
  timestamp: iso(ms),
  message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' },
});
const text = (msgId, value, stop, ms) => ({
  type: 'assistant',
  timestamp: iso(ms),
  message: { id: msgId, role: 'assistant', content: [{ type: 'text', text: value }], stop_reason: stop },
});
const notification = (taskId, status, ms) => ({
  type: 'queue-operation',
  operation: 'enqueue',
  timestamp: iso(ms),
  content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
});

function writeJsonl(file, entries, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  if (mtimeMs) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

function buildFixture() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-collect-'));
  const projectDir = path.join(configDir, 'projects', '-work-demo');
  const transcript = path.join(projectDir, `${SESSION}.jsonl`);
  const subagents = path.join(projectDir, SESSION, 'subagents');

  writeJsonl(transcript, [
    { type: 'ai-title', aiTitle: 'Demo session', sessionId: SESSION },
    prompt('build it', NOW - 115_000),
    notification('a6', 'completed', NOW - 59_000),
    notification('a7', 'completed', NOW - 50_000),
    { type: 'last-prompt', lastPrompt: 'build it', sessionId: SESSION },
    call('m9', 'main-1', 'Bash', { command: 'npm   test', description: 'Run the tests' }, NOW - 3_000),
  ], NOW - 3_000);

  const agent = (id, meta, entries, mtimeMs) => {
    writeJsonl(path.join(subagents, `agent-${id}.jsonl`), entries, mtimeMs);
    if (meta) fs.writeFileSync(path.join(subagents, `agent-${id}.meta.json`), JSON.stringify(meta));
  };
  const bg = (description, extra = {}) => ({ agentType: 'general-purpose', description, requestShape: 'background', spawnDepth: 1, ...extra });

  // Started before either live process: belongs to a process that is gone.
  agent('a5', bg('Orphan'), [prompt('orphan', P1.start - 60_000)], P1.start - 30_000);
  // Started under P1, still running there.
  agent('a4', bg('Old process work'), [prompt('old', P1.start + 60_000), call('x4', 't4', 'Read', { file_path: '/work/demo/a.md' }, NOW - 10_000)], NOW - 10_000);
  // Started under P2: running, nested child, completed, completed by notification, resumed after a notification.
  agent('a1', bg('Build step'), [prompt('build', P2.start + 5_000), call('x1', 't1', 'Bash', { command: 'python3 build.py' }, NOW - 2_000)], NOW - 2_000);
  agent('a3', bg('Child check', { spawnDepth: 2, parentAgentId: 'a1', model: 'haiku' }), [prompt('child', P2.start + 20_000)], NOW - 1_000);
  agent('a2', bg('Finished task'), [prompt('task', P2.start + 10_000), text('x2', 'done', 'end_turn', NOW - 30_000)], NOW - 30_000);
  agent('a6', bg('Notified'), [prompt('n', P2.start + 30_000), text('x6', 'result', null, NOW - 60_000)], NOW - 60_000);
  agent('a7', bg('Resumed'), [prompt('r', P2.start + 40_000), text('x7', 'more', null, NOW - 5_000)], NOW - 5_000);
  // No meta file (older Claude Code): described by its prompt.
  agent('a8', null, [prompt('Summarise the logs please', P2.start + 50_000)], NOW - 4_000);

  fs.mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'sessions', `${P2.pid}.json`),
    JSON.stringify({ pid: P2.pid, sessionId: SESSION, cwd: CWD, startedAt: P2.start + 300, entrypoint: 'sdk-ts', version: '2.1.280' }),
  );
  // Left behind by an earlier process that had P1's pid: must be ignored.
  fs.writeFileSync(
    path.join(configDir, 'sessions', `${P1.pid}.json`),
    JSON.stringify({ pid: P1.pid, sessionId: 'stale-session', cwd: '/elsewhere', startedAt: P1.start - 86_400_000 }),
  );
  return configDir;
}

const shell = (pid, ppid, command, startedAt) => ({
  pid,
  ppid,
  pgid: pid,
  startedAt,
  cpu: 0,
  rssKb: 1000,
  comm: '/bin/zsh',
  args: `${SNAPSHOT}eval '${command}' < /dev/null && pwd -P >| /tmp/claude-1-cwd`,
});

function processList() {
  return [
    { pid: HOST, ppid: 1, pgid: HOST, startedAt: NOW - 86_400_000, cpu: 0, rssKb: 90_000, comm: 'node', args: 'node dist-server/server/index.js' },
    { pid: P1.pid, ppid: HOST, pgid: P1.pid, startedAt: P1.start, cpu: 0.1, rssKb: 200_000, comm: 'claude', args: `claude --output-format stream-json --resume ${SESSION}` },
    { pid: P2.pid, ppid: HOST, pgid: P2.pid, startedAt: P2.start, cpu: 9.5, rssKb: 300_000, comm: 'claude', args: `claude --output-format stream-json --resume ${SESSION}` },
    shell(3001, P2.pid, 'npm test', NOW - 3_000),
    shell(3002, P2.pid, 'sleep 100', NOW - 60_000),
    shell(3003, P2.pid, 'python3 build.py', NOW - 2_000),
    shell(3004, P1.pid, 'tail -f build.log', NOW - 500_000),
    { pid: 3005, ppid: P2.pid, pgid: 3005, startedAt: P2.start, cpu: 0, rssKb: 5000, comm: 'node', args: 'node /x/browser-use-mcp.js' },
    { pid: 4000, ppid: 1, pgid: 4000, startedAt: NOW - 1000, cpu: 0, rssKb: 1000, comm: 'zsh', args: '-zsh' },
    // Exited but never collected by its parent: not a running process.
    { pid: 2999, ppid: HOST, pgid: 2999, zombie: true, startedAt: NOW - 9000, cpu: 0, rssKb: 0, comm: 'claude', args: 'claude' },
  ];
}

function collector(configDir, overrides = {}) {
  return createCollector({
    configDir,
    hostPid: HOST,
    platform: 'darwin',
    home: '/h',
    listProcesses: async () => processList(),
    readStdoutTargets: async (pids) => new Map(pids.filter((pid) => pid === 3002).map((pid) => [pid, `/tmp/claude-501/x/${SESSION}/tasks/bq123.output`])),
    readCwd: async () => CWD,
    ...overrides,
  });
}

test('snapshot attributes agents and shells to the process that runs them', async () => {
  const configDir = buildFixture();
  try {
    const snapshot = await collector(configDir).snapshot({ now: NOW });
    assert.equal(snapshot.supported, true);
    assert.equal(snapshot.home, '/h');
    assert.deepEqual(snapshot.processes.map((proc) => [proc.pid, proc.status]), [[P1.pid, 'background'], [P2.pid, 'working']]);
    assert.deepEqual(snapshot.summary, { processes: 2, background: 1, working: 1, runningAgents: 5, shells: 4 });

    const [old, current] = snapshot.processes;

    assert.equal(current.origin, 'cloudcli');
    assert.equal(current.sessionId, SESSION);
    assert.equal(current.cwd, CWD);
    assert.equal(current.title, 'Demo session');
    assert.equal(current.lastPrompt, 'build it');
    assert.equal(current.version, '2.1.280');
    assert.equal(current.turn.state, 'active');
    assert.deepEqual(current.turn.activity, { kind: 'tool', tools: [{ name: 'Bash', detail: 'Run the tests' }] });

    assert.deepEqual(current.agents.map((agent) => agent.id), ['a1', 'a3', 'a7', 'a8']);
    const [a1, a3, , a8] = current.agents;
    assert.equal(a1.description, 'Build step');
    assert.equal(a1.shape, 'background');
    assert.deepEqual(a1.activity, { kind: 'tool', tools: [{ name: 'Bash', detail: 'python3 build.py' }] });
    assert.equal(a3.parentId, 'a1');
    assert.equal(a3.depth, 2);
    assert.equal(a3.model, 'haiku');
    assert.equal(a8.description, 'Summarise the logs please');
    assert.equal(a8.shape, null);
    assert.equal(current.finishedCount, 2);
    assert.deepEqual(current.finishedAgents, []);

    assert.deepEqual(
      current.shells.map((item) => [item.pid, item.command, item.background, item.agentId, item.taskId]),
      [
        [3001, 'npm test', false, null, null],
        [3002, 'sleep 100', true, null, 'bq123'],
        [3003, 'python3 build.py', false, 'a1', null],
      ],
    );

    // The stale session file is ignored: P1's session comes from its --resume argument.
    assert.equal(old.sessionId, SESSION);
    assert.equal(old.entrypoint, null);
    assert.deepEqual(old.turn, { state: 'done', outcome: 'superseded', at: null, activity: null });
    assert.deepEqual(old.agents.map((agent) => agent.id), ['a4']);
    assert.deepEqual(old.shells.map((item) => [item.pid, item.background]), [[3004, true]]);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('finished agents are listed newest first when requested', async () => {
  const configDir = buildFixture();
  try {
    const snapshot = await collector(configDir).snapshot({ now: NOW, includeFinished: true });
    const current = snapshot.processes.find((proc) => proc.pid === P2.pid);
    assert.deepEqual(
      current.finishedAgents.map((agent) => [agent.id, agent.state, agent.endedAt, agent.activity]),
      [
        ['a2', 'completed', NOW - 30_000, null],
        ['a6', 'completed', NOW - 59_000, null],
      ],
    );
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('a session whose turn has ended shows its background work', async () => {
  const configDir = buildFixture();
  try {
    const transcript = path.join(configDir, 'projects', '-work-demo', `${SESSION}.jsonl`);
    fs.appendFileSync(transcript, `${JSON.stringify({ type: 'user', timestamp: iso(NOW - 2_000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'main-1', content: 'ok' }] } })}\n`);
    fs.appendFileSync(transcript, `${JSON.stringify(text('m10', 'All done.', 'end_turn', NOW - 1_000))}\n`);
    const onlyP2 = () => processList().filter((proc) => proc.pid !== P1.pid && proc.ppid !== P1.pid && proc.pid !== 3001);
    const snapshot = await collector(configDir, { listProcesses: async () => onlyP2() }).snapshot({ now: NOW });
    assert.equal(snapshot.processes.length, 1);
    const [proc] = snapshot.processes;
    assert.equal(proc.turn.state, 'done');
    assert.equal(proc.status, 'background');
    // a4 started before the only live process: it is not running anywhere now.
    assert.equal(proc.agents.some((agent) => agent.id === 'a4'), false);
    assert.equal(proc.shells.every((item) => item.background || item.agentId), true);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('processes without a session or transcript still appear', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-empty-'));
  try {
    const list = [
      { pid: 5000, ppid: 4000, pgid: 5000, startedAt: NOW - 5000, cpu: 1, rssKb: 100_000, comm: 'claude', args: 'claude' },
      { pid: 4000, ppid: 1, pgid: 4000, startedAt: NOW - 9000, cpu: 0, rssKb: 1000, comm: 'zsh', args: '-zsh' },
    ];
    const snapshot = await collector(configDir, { listProcesses: async () => list }).snapshot({ now: NOW });
    assert.equal(snapshot.processes.length, 1);
    const [proc] = snapshot.processes;
    assert.equal(proc.sessionId, null);
    assert.equal(proc.transcriptFound, false);
    assert.equal(proc.origin, 'unknown');
    assert.equal(proc.status, 'idle');
    assert.deepEqual(proc.turn, { state: 'unknown', outcome: null, at: null, activity: null });
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('Windows is reported as unsupported', async () => {
  const snapshot = await createCollector({ platform: 'win32', listProcesses: async () => assert.fail('not called') }).snapshot({ now: NOW });
  assert.equal(snapshot.supported, false);
  assert.deepEqual(snapshot.processes, []);
});

test('classifyOrigin', () => {
  const byPid = new Map([
    [10, { pid: 10, args: 'node /usr/lib/node_modules/@siteboon/claude-code-ui/dist-server/server/index.js' }],
    [11, { pid: 11, args: '-zsh' }],
  ]);
  assert.equal(classifyOrigin({ ppid: 99 }, byPid, 99, 'sdk-ts'), 'cloudcli');
  assert.equal(classifyOrigin({ ppid: 10 }, byPid, 99, 'sdk-ts'), 'cloudcli');
  assert.equal(classifyOrigin({ ppid: 11 }, byPid, 99, 'cli'), 'terminal');
  assert.equal(classifyOrigin({ ppid: 11 }, byPid, 99, 'claude-vscode'), 'ide');
  assert.equal(classifyOrigin({ ppid: 11 }, byPid, 99, 'sdk-py'), 'sdk');
  assert.equal(classifyOrigin({ ppid: 11 }, byPid, 99, 'something-new'), 'unknown');
  assert.equal(classifyOrigin({ ppid: 11 }, byPid, 99, null), 'unknown');
});
