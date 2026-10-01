import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodePsEscapes,
  extractShellCommand,
  isClaudeProcess,
  isToolShell,
  parseCommOutput,
  parseEtime,
  parseLsofNames,
  parsePsOutput,
  sessionIdFromArgs,
  taskIdFromOutputPath,
} from '../server/processes.js';

const SNAPSHOT = '/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot-zsh-1790000000000-abc123.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && { \\builtin unalias -- \'unsetenv\'; \\builtin unset -f -- \'unsetenv\'; } >/dev/null 2>&1 || true && ';

test('parseEtime handles every ps elapsed-time shape', () => {
  assert.equal(parseEtime('00:07'), 7);
  assert.equal(parseEtime('03:35'), 215);
  assert.equal(parseEtime('01:02:03'), 3723);
  assert.equal(parseEtime('08-06:23:09'), 8 * 86400 + 6 * 3600 + 23 * 60 + 9);
  assert.equal(parseEtime(' 12:00 '), 720);
  assert.equal(parseEtime('nonsense'), null);
});

test('parsePsOutput reads pid, parent, group, state, start, usage and args', () => {
  const now = 1_000_000_000;
  const rows = parsePsOutput(
    [
      '39031 38975 38975 Ss   08-06:23:09   0.0  91344 node dist-server/server/index.js',
      '  647 39031   647 R+         11:26   2,5 380864 claude --output-format stream-json --resume 6f1d2c84-1a7e-4c59-9b0e-2f8a4d7c3e15',
      '  702   647   702 Z          00:01   0.0      0 [sh] <defunct>',
      'garbage line',
      '',
    ].join('\n'),
    now,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], {
    pid: 647,
    ppid: 39031,
    pgid: 647,
    zombie: false,
    startedAt: now - 686_000,
    cpu: 2.5,
    rssKb: 380864,
    args: 'claude --output-format stream-json --resume 6f1d2c84-1a7e-4c59-9b0e-2f8a4d7c3e15',
  });
  assert.equal(rows[2].zombie, true);
});

test('parseCommOutput keeps names that contain spaces', () => {
  const names = parseCommOutput('  4121 claude\n4377 /Applications/Some App.app/Contents/MacOS/Some App\n');
  assert.equal(names.get(4121), 'claude');
  assert.equal(names.get(4377), '/Applications/Some App.app/Contents/MacOS/Some App');
});

test('isClaudeProcess recognises the CLI however it was started', () => {
  assert.equal(isClaudeProcess({ comm: 'claude', args: 'claude --output-format stream-json' }), true);
  assert.equal(isClaudeProcess({ comm: '', args: '/opt/homebrew/bin/claude' }), true);
  assert.equal(isClaudeProcess({ comm: '/Users/me/Library/Application Support/Claude/claude-code/2.1.0/claude', args: '/Users/me/Library/Application' }), true);
  assert.equal(isClaudeProcess({ comm: 'node', args: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --print' }), true);
  assert.equal(isClaudeProcess({ comm: 'claude.exe', args: 'claude.exe' }), true);

  assert.equal(isClaudeProcess({ comm: 'node', args: 'node /Users/me/.claude-code-ui/plugins/cloudcli-plugin-claude-usage/dist/server.js' }), false);
  assert.equal(isClaudeProcess({ comm: '/Applications/Claude.app/Contents/MacOS/Claude', args: '/Applications/Claude.app/Contents/MacOS/Claude' }), false);
  assert.equal(isClaudeProcess({ comm: 'node', args: 'node dist-server/server/index.js' }), false);
});

test('isToolShell matches only Bash tool wrappers', () => {
  assert.equal(isToolShell(`${SNAPSHOT}eval 'sleep 300' < /dev/null && pwd -P >| /tmp/claude-d9f4-cwd`), true);
  assert.equal(isToolShell('/bin/zsh -c echo hi'), false);
  assert.equal(isToolShell('node /x/browser-use-mcp.js'), false);
});

test('extractShellCommand recovers quoting, control characters and non-ASCII text', () => {
  assert.equal(
    extractShellCommand(`${SNAPSHOT}eval 'sleep 300; echo am-probe-done' < /dev/null && pwd -P >| /tmp/claude-d9f4-cwd`),
    'sleep 300; echo am-probe-done',
  );
  // Captured from `ps` for: sleep 45; echo 'it''s "quoted" $HOME'
  assert.equal(
    extractShellCommand(`${SNAPSHOT}eval 'sleep 45; echo '"'"'it'"'"''"'"'s "quoted" $HOME'"'"'' < /dev/null && pwd -P >| /tmp/claude-0098-cwd`),
    `sleep 45; echo 'it''s "quoted" $HOME'`,
  );
  // macOS ps prints a tab as \011 and a newline as \012 but leaves UTF-8 and backslashes alone.
  assert.equal(
    extractShellCommand(`${SNAPSHOT}eval 'sleep 30 # 한글 \\ 백슬래시\\011탭\\012echo done' < /dev/null && pwd -P >| /tmp/c`),
    'sleep 30 # 한글 \\ 백슬래시\t탭\necho done',
  );
  assert.equal(extractShellCommand(`${SNAPSHOT}eval 'echo '\\''x'\\''' < /dev/null`), "echo 'x'");
  assert.equal(extractShellCommand('/bin/zsh -c something else'), '/bin/zsh -c something else');
});

test('decodePsEscapes only touches control-character escapes', () => {
  assert.equal(decodePsEscapes('a\\012b\\011c'), 'a\nb\tc');
  assert.equal(decodePsEscapes('keep \\d and \\101'), 'keep \\d and \\101');
});

test('taskIdFromOutputPath and sessionIdFromArgs', () => {
  assert.equal(taskIdFromOutputPath('/private/tmp/claude-501/-Users-me-x/6f1d2c84/tasks/b7xk2m9qp.output'), 'b7xk2m9qp');
  assert.equal(taskIdFromOutputPath('pipe:[123]'), null);
  assert.equal(taskIdFromOutputPath(undefined), null);

  const id = '6f1d2c84-1a7e-4c59-9b0e-2f8a4d7c3e15';
  assert.equal(sessionIdFromArgs(`claude --model default --resume ${id} --allowedTools Bash`), id);
  assert.equal(sessionIdFromArgs(`claude --session-id=${id}`), id);
  assert.equal(sessionIdFromArgs('claude --print hello'), null);
});

test('parseLsofNames reads lsof field output', () => {
  const names = parseLsofNames('p73485\nf1\nn/private/tmp/claude-501/x/tasks/b7xk2m9qp.output\np73517\nf1\nnpipe\n');
  assert.equal(names.get(73485), '/private/tmp/claude-501/x/tasks/b7xk2m9qp.output');
  assert.equal(names.get(73517), 'pipe');
});
