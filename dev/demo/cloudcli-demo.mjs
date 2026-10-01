// Stages the Agent Monitor demo: three Claude Code sessions whose transcripts are
// written in real time, in Claude Code's format. The path of this script contains
// "cloudcli", so Agent Monitor files the sessions it starts under CloudCLI.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const PROJECTS = path.join(HOME, '.claude', 'projects');
const VERSION = '2.1.280';
const MODEL = 'claude-sonnet-5';

const sessions = {
  shop: { sessionId: '6f1d2c84-1a7e-4c59-9b0e-2f8a4d7c3e15', cwd: `${HOME}/code/shop-api`, entrypoint: 'sdk-ts' },
  docs: { sessionId: '0c9e7b21-5d4f-4e8a-a3c6-71b2f0d9e845', cwd: `${HOME}/code/docs-site`, entrypoint: 'sdk-ts' },
  mobile: { sessionId: '9a3f6e10-2b7c-4d85-8e41-c6d0b5a2f973', cwd: `${HOME}/code/mobile-app`, entrypoint: 'cli' },
};

const dirOf = (session) => path.join(PROJECTS, session.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
const toolId = () => `toolu_${randomBytes(12).toString('hex')}`;
const message = (content, stop) => ({
  model: MODEL,
  id: `msg_${randomBytes(12).toString('hex')}`,
  type: 'message',
  role: 'assistant',
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1800, output_tokens: 240, cache_read_input_tokens: 21000, cache_creation_input_tokens: 0 },
});

class Thread {
  constructor(session, agent = null) {
    this.session = session;
    this.agent = agent;
    this.parent = null;
    this.file = agent
      ? path.join(dirOf(session), session.sessionId, 'subagents', `agent-${agent.id}.jsonl`)
      : path.join(dirOf(session), `${session.sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (agent) {
      const { id, ...meta } = agent;
      fs.writeFileSync(this.file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ requestNonInteractive: true, toolUseId: toolId(), ...meta }));
    }
  }

  raw(entry) {
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }

  write(entry) {
    const full = {
      parentUuid: this.parent,
      isSidechain: Boolean(this.agent),
      ...(this.agent ? { agentId: this.agent.id } : {}),
      userType: 'external',
      entrypoint: this.session.entrypoint,
      cwd: this.session.cwd,
      sessionId: this.session.sessionId,
      version: VERSION,
      gitBranch: 'main',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.parent = full.uuid;
    this.raw(full);
  }

  user(text) {
    this.write({ type: 'user', message: { role: 'user', content: text } });
  }

  say(text) {
    this.write({ type: 'assistant', message: message([{ type: 'text', text }], 'end_turn') });
  }

  // Parallel tool calls: one message, one entry per block, as Claude Code writes them.
  call(...calls) {
    const shared = message([], null);
    return calls.map(([name, input], index) => {
      const id = toolId();
      const last = index === calls.length - 1;
      this.write({ type: 'assistant', message: { ...shared, content: [{ type: 'tool_use', id, name, input }], stop_reason: last ? 'tool_use' : null } });
      return id;
    });
  }

  result(id, text) {
    this.write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  }
}

const launch = (session, shells = []) =>
  spawn(process.execPath, ['/demo/fake-claude.mjs'], {
    argv0: 'claude',
    env: { ...process.env, DEMO_SESSION: JSON.stringify({ ...session, shells }) },
    stdio: 'ignore',
  });

// The processes start first, so every agent starts while its process runs.
launch(sessions.shop, [
  { command: 'npm test -- --grep webhooks', stub: 'npm() { sleep 86400; }', taskId: 'bt6w1c9hz', delayMs: 13_000 },
  { command: 'npm run dev -- --port 4010', stub: 'npm() { sleep 86400; }', taskId: 'b8k2q7m4x', delayMs: 17_000 },
]);
launch(sessions.docs);
spawn(process.execPath, ['/demo/terminal.mjs'], { env: { ...process.env, DEMO_SESSION: JSON.stringify(sessions.mobile) }, stdio: 'ignore' });

const later = (seconds, fn) => setTimeout(fn, seconds * 1000);
const launched = 'Async agent launched successfully. The agent is working in the background; you will be notified when it completes.';
const shop = new Thread(sessions.shop);
const docs = new Thread(sessions.docs);
const mobile = new Thread(sessions.mobile);
let mapper;
let audit;
let keys;
let collector;

// shop-api: the turn ends at 22s while two agents and the dev server keep running.
later(2, () => {
  shop.raw({ type: 'ai-title', aiTitle: 'Refactor payment webhooks', sessionId: sessions.shop.sessionId });
  shop.user('Split the webhook handler per provider and make retries idempotent. Run the retry audit in the background so I can keep working.');
  shop.raw({ type: 'last-prompt', lastPrompt: 'Split the webhook handler per provider and make retries idempotent. Run the retry audit in the background so I can keep working.', sessionId: sessions.shop.sessionId });
});
later(4, () => {
  const [id] = shop.call(['Agent', { description: 'Map webhook handlers', subagent_type: 'Explore', prompt: 'List every webhook handler under src/webhooks and how each one retries.', run_in_background: true }]);
  shop.result(id, launched);
  mapper = new Thread(sessions.shop, { id: 'a91c0e2f4b7d61a35', agentType: 'Explore', description: 'Map webhook handlers', spawnDepth: 1, requestShape: 'background' });
  mapper.user('List every webhook handler under src/webhooks and how each one retries.');
});
let globId;
later(6, () => { [globId] = mapper.call(['Glob', { pattern: 'src/webhooks/**/*.ts' }]); });
later(7, () => mapper.result(globId, 'src/webhooks/router.ts\nsrc/webhooks/stripe.ts\nsrc/webhooks/paypal.ts\nsrc/webhooks/adyen.ts\nsrc/webhooks/retry.ts'));
later(8, () => {
  const [id] = shop.call(['Agent', { description: 'Audit retry logic', subagent_type: 'general-purpose', prompt: 'Audit how webhook retries are scheduled and deduplicated, then run the webhook tests.', run_in_background: true }]);
  shop.result(id, launched);
  audit = new Thread(sessions.shop, { id: 'a4d2b8e61f0c93a7e', agentType: 'general-purpose', description: 'Audit retry logic', spawnDepth: 1, requestShape: 'background' });
  audit.user('Audit how webhook retries are scheduled and deduplicated, then run the webhook tests.');
});
later(9, () => {
  const ids = mapper.call(['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/router.ts` }], ['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/retry.ts` }]);
  later(1, () => ids.forEach((id) => mapper.result(id, '(file contents)')));
});
later(10, () => {
  const [id] = audit.call(['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/retry.ts` }]);
  later(0.5, () => audit.result(id, '(file contents)'));
});
later(11, () => {
  const [id] = audit.call(['Agent', { description: 'Check idempotency keys', subagent_type: 'general-purpose', model: 'haiku', prompt: 'Check that every provider handler dedupes on the event id before it has side effects.', run_in_background: true }]);
  audit.result(id, launched);
  keys = new Thread(sessions.shop, { id: 'a7e3f19c0d2b84e56', agentType: 'general-purpose', description: 'Check idempotency keys', spawnDepth: 2, requestShape: 'background', parentAgentId: 'a4d2b8e61f0c93a7e', model: 'haiku' });
  keys.user('Check that every provider handler dedupes on the event id before it has side effects.');
});
later(12.5, () => audit.call(['Bash', { command: 'npm test -- --grep webhooks', description: 'Run the webhook tests' }]));
later(14, () => {
  const [id] = shop.call(['Bash', { command: 'npm run dev -- --port 4010', description: 'Start the dev server', run_in_background: true }]);
  later(3.5, () => shop.result(id, `Command running in background with ID: b8k2q7m4x. Output is being written to: /tmp/claude-${process.getuid()}/tasks/b8k2q7m4x.output`));
});
later(20, () => mapper.say('Found four handlers behind router.ts. Stripe and Adyen retry with exponential backoff; PayPal retries immediately and does not dedupe.'));
later(22, () => {
  shop.say('The webhook handler is now split into stripe.ts, paypal.ts and adyen.ts behind one router, and every provider dedupes on the event id before it touches an order.\n\nThe retry audit is still running in the background, and the dev server is up on port 4010. I will report back when the audit finishes.');
});

// The nested agent keeps reading and searching.
const keySteps = [
  [['Grep', { pattern: 'idempotency_key', path: 'src' }], ['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/stripe.ts` }]],
  [['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/paypal.ts` }]],
  [['Grep', { pattern: 'event\\.id', path: 'src/webhooks' }], ['Read', { file_path: `${sessions.shop.cwd}/src/webhooks/adyen.ts` }]],
];
let keyStep = 0;
let keyPending = [];
later(13, () => setInterval(() => {
  keyPending.forEach((id) => keys.result(id, '(results)'));
  keyPending = keys.call(...keySteps[keyStep++ % keySteps.length]);
}, 5000));

// docs-site: a foreground agent works through the merged pull requests.
later(2.5, () => {
  docs.raw({ type: 'ai-title', aiTitle: 'Write release notes for v2.4', sessionId: sessions.docs.sessionId });
  docs.user('Draft the v2.4 release notes from the merged PRs.');
  docs.raw({ type: 'last-prompt', lastPrompt: 'Draft the v2.4 release notes from the merged PRs.', sessionId: sessions.docs.sessionId });
});
later(4, () => {
  docs.call(['Agent', { description: 'Collect merged PRs', subagent_type: 'general-purpose', prompt: 'List the PRs merged since v2.3 with their titles and labels.' }]);
  collector = new Thread(sessions.docs, { id: 'a2b6c0e9f4d8172ab', agentType: 'general-purpose', description: 'Collect merged PRs', spawnDepth: 1, requestShape: 'foreground' });
  collector.user('List the PRs merged since v2.3 with their titles and labels.');
});
let page = 1;
let pagePending = [];
later(6, () => setInterval(() => {
  pagePending.forEach((id) => collector.result(id, '(page contents)'));
  pagePending = collector.call(['WebFetch', { url: `https://github.com/acme/docs-site/pulls?q=is%3Amerged&page=${(page++ % 4) + 1}`, prompt: 'List the PR titles and labels' }]);
}, 4000));

// mobile-app: a terminal session that finished its turn and waits for input.
later(2, () => {
  mobile.raw({ type: 'ai-title', aiTitle: 'Fix flaky login test', sessionId: sessions.mobile.sessionId });
  mobile.user('The login e2e test fails one run in five. Find out why.');
  mobile.raw({ type: 'last-prompt', lastPrompt: 'The login e2e test fails one run in five. Find out why.', sessionId: sessions.mobile.sessionId });
  const [id] = mobile.call(['Read', { file_path: `${sessions.mobile.cwd}/e2e/login.spec.ts` }]);
  mobile.result(id, '(file contents)');
  mobile.say('The test clicks Sign in before the session cookie is set, so one run in five lands on the login page again. I added a wait for the /session response; 50 runs in a row now pass.');
});

setInterval(() => {}, 60_000);
