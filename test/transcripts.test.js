import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  TranscriptIndex,
  findTranscript,
  notificationTexts,
  parseTaskNotifications,
  projectDirName,
  readFirstEntry,
  readThreadState,
  readWorkflowJournal,
  scanBackward,
} from '../server/transcripts.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-transcripts-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function writeJsonl(entries, { trailing = '' } = {}) {
  const file = path.join(tmp, `t${counter++}.jsonl`);
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n' + trailing);
  return file;
}

const at = (s) => new Date(Date.UTC(2026, 9, 1, 0, 0, s)).toISOString();
const prompt = (text, s = 0, extra = {}) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: text }, ...extra });
const block = (msgId, content, stop = null, s = 1, extra = {}) => ({
  type: 'assistant',
  timestamp: at(s),
  message: { id: msgId, role: 'assistant', content: [content], stop_reason: stop },
  ...extra,
});
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (toolUseId, text, s = 2) => ({
  type: 'user',
  timestamp: at(s),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
});
const attachment = (s = 3) => ({ type: 'attachment', timestamp: at(s), attachment: { type: 'hook_success' } });

test('scanBackward visits complete lines newest first across chunk boundaries', () => {
  const entries = [{ n: 1, s: '가나다' }, { n: 2, s: 'x'.repeat(40) }, { n: 3, s: '라마바사' }];
  const file = writeJsonl(entries, { trailing: '{"n":4,"partial' });
  for (const chunkSize of [1, 3, 7, 64, 4096]) {
    const seen = [];
    scanBackward(file, (entry) => {
      seen.push(entry);
      return false;
    }, { chunkSize });
    assert.deepEqual(seen, [...entries].reverse(), `chunkSize ${chunkSize}`);
  }
});

test('scanBackward stops when asked and respects maxBytes', () => {
  const file = writeJsonl([{ n: 1 }, { n: 2 }, { n: 3 }]);
  const seen = [];
  scanBackward(file, (entry) => {
    seen.push(entry.n);
    return entry.n === 2;
  });
  assert.deepEqual(seen, [3, 2]);

  // Each line is 8 bytes. 12 bytes from the end reach the newline before line 3 but not the one before line 2.
  const limited = [];
  scanBackward(file, (entry) => limited.push(entry.n) && false, { chunkSize: 4, maxBytes: 12 });
  assert.deepEqual(limited, [3]);
  scanBackward(path.join(tmp, 'missing.jsonl'), () => assert.fail('no file, no visit'));
});

test('readThreadState: final answer, API error and interruption end a thread', () => {
  const done = readThreadState(writeJsonl([prompt('go'), block('m1', { type: 'text', text: 'done' }, 'end_turn', 5), attachment()]));
  assert.deepEqual(done, { state: 'done', outcome: 'completed', at: Date.parse(at(5)) });

  const error = readThreadState(writeJsonl([prompt('go'), block('m1', { type: 'text', text: 'API Error' }, 'stop_sequence', 4, { isApiErrorMessage: true })]));
  assert.equal(error.outcome, 'error');

  const interrupted = readThreadState(writeJsonl([
    prompt('go'),
    block('m1', toolUse('t1', 'Bash', { command: 'ls' }), 'tool_use'),
    result('t1', '[Request interrupted by user for tool use]'),
    prompt('[Request interrupted by user for tool use]', 3),
  ]));
  assert.equal(interrupted.state, 'done');
  assert.equal(interrupted.outcome, 'interrupted');

  const resultOnly = readThreadState(writeJsonl([prompt('go'), block('m1', toolUse('t1', 'Bash', { command: 'ls' }), 'tool_use'), result('t1', '[Request interrupted by user for tool use]')]));
  assert.equal(resultOnly.outcome, 'interrupted');
});

test('readThreadState: pending tool calls, including parallel ones', () => {
  const single = readThreadState(writeJsonl([
    prompt('go'),
    block('m1', { type: 'thinking', thinking: '...' }),
    block('m1', toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' }), 'tool_use'),
  ]));
  assert.deepEqual(single.activity, { kind: 'tool', tools: [{ name: 'Bash', detail: 'Run tests', command: 'npm test' }] });

  // Three parallel calls, one already answered.
  const parallel = readThreadState(writeJsonl([
    prompt('go'),
    block('m2', toolUse('a', 'Read', { file_path: '/x/a.md' })),
    block('m2', toolUse('b', 'Grep', { pattern: 'TODO' })),
    block('m2', toolUse('c', 'WebFetch', { url: 'https://example.com' }), 'tool_use'),
    result('b', 'no matches'),
  ]));
  assert.equal(parallel.state, 'active');
  assert.deepEqual(parallel.activity.tools.map((tool) => tool.name), ['Read', 'WebFetch']);
  assert.equal(parallel.activity.tools[0].detail, '/x/a.md');
  // A search is described by what it looks for, not where.
  assert.equal(readThreadState(writeJsonl([prompt('go'), block('m4', toolUse('g', 'Grep', { path: 'src', pattern: 'idempotency_key' }), 'tool_use')])).activity.tools[0].detail, 'idempotency_key');

  // Older transcripts keep every block of a message in one entry.
  const combined = readThreadState(writeJsonl([
    prompt('go'),
    {
      type: 'assistant',
      timestamp: at(1),
      message: { id: 'm3', role: 'assistant', content: [toolUse('p', 'Read', { file_path: '/p' }), toolUse('q', 'Grep', { pattern: 'q' })], stop_reason: 'tool_use' },
    },
  ]));
  assert.deepEqual(combined.activity.tools.map((tool) => tool.name), ['Read', 'Grep']);
});

test('readThreadState: thinking, responding and bookkeeping entries', () => {
  const answered = readThreadState(writeJsonl([prompt('go'), block('m1', toolUse('t1', 'Read', { file_path: '/a' }), 'tool_use'), result('t1', 'text')]));
  assert.deepEqual(answered.activity, { kind: 'thinking' });

  const fresh = readThreadState(writeJsonl([block('m0', { type: 'text', text: 'hi' }, 'end_turn'), prompt('next', 9)]));
  assert.deepEqual(fresh.activity, { kind: 'thinking' });

  const streaming = readThreadState(writeJsonl([prompt('go'), block('m1', { type: 'text', text: 'partial answer' })]));
  assert.deepEqual(streaming.activity, { kind: 'responding' });

  // A local slash command and a compaction summary do not start a turn.
  const local = readThreadState(writeJsonl([
    prompt('go'),
    block('m1', { type: 'text', text: 'ok' }, 'end_turn', 2),
    prompt('<local-command-caveat>Caveat</local-command-caveat>', 3, { isMeta: true }),
    prompt('<command-name>/model</command-name>', 4),
    prompt('<local-command-stdout>Set model</local-command-stdout>', 5),
    prompt('This session is being continued from a previous conversation', 6, { isCompactSummary: true }),
  ]));
  assert.equal(local.state, 'done');

  // Main-thread view ignores sidechain entries from older transcript layouts.
  const sidechain = readThreadState(writeJsonl([
    block('m1', { type: 'text', text: 'ok' }, 'end_turn', 2),
    block('s1', toolUse('x', 'Bash', { command: 'ls' }), 'tool_use', 3, { isSidechain: true }),
  ]), { mainThread: true });
  assert.equal(sidechain.state, 'done');

  assert.deepEqual(readThreadState(writeJsonl([attachment()])), { state: 'unknown' });
});

test('readFirstEntry reads the opening line, or salvages its timestamp', () => {
  const file = writeJsonl([prompt('first', 7), prompt('second', 8)]);
  assert.equal(readFirstEntry(file).timestamp, at(7));
  const long = writeJsonl([{ type: 'user', message: { content: 'y'.repeat(5000) }, timestamp: at(9) }]);
  assert.equal(readFirstEntry(long, 1024)?.timestamp, undefined);
  const stampFirst = writeJsonl([{ timestamp: at(9), type: 'user', message: { content: 'y'.repeat(5000) } }]);
  assert.equal(readFirstEntry(stampFirst, 1024).timestamp, at(9));
  assert.equal(readFirstEntry(path.join(tmp, 'missing.jsonl')), null);
});

const NOTIFICATION = [
  '<task-notification>',
  '<task-id>a1b2c3d4e5f6a7b8c</task-id>',
  '<tool-use-id>toolu_01ABC</tool-use-id>',
  '<output-file>/private/tmp/claude-501/x/tasks/a1b2c3d4e5f6a7b8c.output</output-file>',
  '<status>completed</status>',
  '<summary>Agent "Survey" finished</summary>',
  '</task-notification>',
].join('\n');

test('parseTaskNotifications reads every notification in a text', () => {
  const notes = parseTaskNotifications(`${NOTIFICATION}\n${NOTIFICATION.replace('a1b2c3d4e5f6a7b8c', 'b2').replace('completed', 'Killed')}`);
  assert.deepEqual(notes, [
    { taskId: 'a1b2c3d4e5f6a7b8c', status: 'completed', toolUseId: 'toolu_01ABC' },
    { taskId: 'b2', status: 'killed', toolUseId: 'toolu_01ABC' },
  ]);
  assert.deepEqual(parseTaskNotifications('<task-notification> arrives when the workflow completes.'), []);
});

test('notificationTexts accepts only entries Claude Code writes for notifications', () => {
  assert.deepEqual(notificationTexts({ type: 'queue-operation', operation: 'enqueue', content: NOTIFICATION }), [NOTIFICATION]);
  assert.deepEqual(notificationTexts({ type: 'user', origin: { kind: 'task-notification' }, message: { content: NOTIFICATION } }), [NOTIFICATION]);
  assert.deepEqual(
    notificationTexts({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: NOTIFICATION } }),
    [NOTIFICATION],
  );
  // Quoted in a tool result or typed by the user: not a notification.
  assert.deepEqual(notificationTexts(result('t1', NOTIFICATION)), []);
  assert.deepEqual(notificationTexts(prompt(NOTIFICATION)), []);
});

test('TranscriptIndex follows appends, titles and notifications', () => {
  const file = path.join(tmp, 'index.jsonl');
  const line = (entry) => `${JSON.stringify(entry)}\n`;
  fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: '첫 제목' }) + line({ type: 'last-prompt', lastPrompt: '회의록을 요약해 줘' }));

  const index = new TranscriptIndex({ chunkSize: 5 });
  let state = index.update(file);
  assert.equal(state.aiTitle, '첫 제목');
  assert.equal(state.lastPrompt, '회의록을 요약해 줘');

  // A notification line written in two parts, plus one quoted in a tool result.
  const notice = line({ type: 'queue-operation', operation: 'enqueue', timestamp: at(30), content: NOTIFICATION });
  fs.appendFileSync(file, line(result('t9', NOTIFICATION.replace('a1b2c3d4e5f6a7b8c', 'quoted'))) + notice.slice(0, 40));
  state = index.update(file);
  assert.equal(state.notifications.size, 0);
  fs.appendFileSync(file, notice.slice(40) + line({ type: 'custom-title', customTitle: 'Renamed' }));
  state = index.update(file);
  assert.deepEqual([...state.notifications.keys()], ['a1b2c3d4e5f6a7b8c']);
  assert.equal(state.notifications.get('a1b2c3d4e5f6a7b8c').at, Date.parse(at(30)));
  assert.equal(state.customTitle, 'Renamed');

  // A rewritten (shorter) file is read again from the start.
  fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: 'Fresh' }));
  state = index.update(file);
  assert.equal(state.aiTitle, 'Fresh');
  assert.equal(state.notifications.size, 0);

  assert.equal(index.update(path.join(tmp, 'gone.jsonl')), null);
  index.prune(0, Date.now() + 1);
  assert.equal(index.files.size, 0);
});

test('projectDirName and findTranscript', () => {
  assert.equal(projectDirName('/Users/me/my_project.v2'), '-Users-me-my-project-v2');
  const projects = path.join(tmp, 'projects');
  const sessionId = '11111111-2222-4333-8444-555555555555';
  fs.mkdirSync(path.join(projects, '-work-a'), { recursive: true });
  fs.mkdirSync(path.join(projects, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(projects, '-work-a', `${sessionId}.jsonl`), '');
  assert.equal(findTranscript(projects, sessionId, '/work/a'), path.join(projects, '-work-a', `${sessionId}.jsonl`));
  fs.renameSync(path.join(projects, '-work-a', `${sessionId}.jsonl`), path.join(projects, 'elsewhere', `${sessionId}.jsonl`));
  assert.equal(findTranscript(projects, sessionId, '/work/a'), path.join(projects, 'elsewhere', `${sessionId}.jsonl`));
  assert.equal(findTranscript(projects, 'nope', '/work/a'), null);
  assert.equal(findTranscript(path.join(tmp, 'no-projects'), sessionId, null), null);
});

test('readWorkflowJournal settles agents and skips a line still being written', () => {
  const file = writeJsonl(
    [
      { type: 'started', agentId: 'w1', label: 'draft:X1', phase: 'Draft' },
      { type: 'started', agentId: 'w2', label: 'draft:X2' },
      { type: 'started', agentId: 'w3' },
      { type: 'result', agentId: 'w1', result: 'ok', timestamp: at(9) },
      { type: 'failed', agentId: 'w2', error: 'boom' },
      { type: 'result', agentId: 'unknown' },
    ],
    { trailing: '{"type":"result","agentId":"w3"' },
  );
  assert.deepEqual([...readWorkflowJournal(file)], [
    ['w1', { label: 'draft:X1', phase: 'Draft', status: 'completed', at: Date.parse(at(9)) }],
    ['w2', { label: 'draft:X2', phase: null, status: 'failed', at: null }],
    ['w3', { label: null, phase: null, status: 'running', at: null }],
  ]);
  assert.equal(readWorkflowJournal(path.join(tmp, 'missing.jsonl')).size, 0);
});
