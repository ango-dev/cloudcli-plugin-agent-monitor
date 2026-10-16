// Builds the status snapshot: Claude Code processes, their sessions, subagents and shells.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as procs from './processes.js';
import {
  TranscriptIndex,
  claudeConfigDir,
  findTranscript,
  parseTime,
  promptText,
  readFirstEntry,
  readThreadState,
  readWorkflowJournal,
} from './transcripts.js';

// An agent belongs to the newest live process of its session that had started by then.
const OWNER_TOLERANCE_MS = 1500;
// A notification counts as final unless the agent wrote to its transcript after it.
const NOTIFICATION_TOLERANCE_MS = 2000;
const FINISHED_LIMIT = 20;
// A workflow with no agent running is between phases until it has been quiet this long.
const WORKFLOW_GAP_MS = 60 * 1000;
const CACHE_IDLE_MS = 10 * 60 * 1000;
// Command lines of a cloudcli server, for when the monitor is not its child.
const HOST_MARKER = /claude-code-ui|cloudcli|claudecodeui|dist-server[\\/]server[\\/]index\.js/i;

const OUTCOME_STATE = { completed: 'completed', error: 'failed', interrupted: 'interrupted' };
const NOTIFICATION_STATE = { completed: 'completed', failed: 'failed', killed: 'killed', cancelled: 'killed', stopped: 'stopped' };
const STATUS_ORDER = { background: 0, working: 1, idle: 2 };

const ENTRYPOINT_ORIGIN = {
  cli: 'terminal',
  'claude-vscode': 'ide',
  'claude-jetbrains': 'ide',
  'claude-desktop': 'desktop',
};

export function classifyOrigin(proc, byPid, hostPid, entrypoint) {
  if (hostPid && proc.ppid === hostPid) return 'cloudcli';
  const parent = byPid.get(proc.ppid);
  if (parent && HOST_MARKER.test(parent.args)) return 'cloudcli';
  if (!entrypoint) return 'unknown';
  if (ENTRYPOINT_ORIGIN[entrypoint]) return ENTRYPOINT_ORIGIN[entrypoint];
  return entrypoint.startsWith('sdk') ? 'sdk' : 'unknown';
}

const commandKey = (command) => String(command).replace(/\s+/g, ' ').trim().slice(0, 200);

/** Bash commands a thread is waiting on, keyed for comparison with running shells. */
function pendingCommands(activity) {
  if (activity?.kind !== 'tool') return [];
  return activity.tools.filter((tool) => tool.command).map((tool) => commandKey(tool.command));
}

/** Activity as sent to the UI, without the full commands kept for matching. */
function publicActivity(activity) {
  if (!activity) return null;
  if (activity.kind !== 'tool') return activity;
  return { kind: 'tool', tools: activity.tools.map(({ name, detail }) => ({ name, detail })) };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The newest of `owners` (sorted by start) that had started by `startedAt`. */
function ownerAt(sortedOwners, startedAt) {
  let owner = null;
  for (const proc of sortedOwners) {
    if (proc.startedAt <= startedAt + OWNER_TOLERANCE_MS) owner = proc;
  }
  return owner;
}

/**
 * Turns the agents of one session into records attributed to the live
 * process that runs them, with their state resolved.
 */
export function resolveAgents(rawAgents, owners, notifications) {
  const byId = new Map(rawAgents.map((agent) => [agent.id, agent]));
  const sortedOwners = [...owners].sort((a, b) => a.startedAt - b.startedAt);
  const ownerByTime = (startedAt) => ownerAt(sortedOwners, startedAt);

  // Nested agents run in the same process as their root ancestor.
  const ownerOf = (agent, depth = 0) => {
    if (agent.owner !== undefined) return agent.owner;
    const parent = agent.parentId ? byId.get(agent.parentId) : null;
    agent.owner = parent && depth < 16 ? ownerOf(parent, depth + 1) : ownerByTime(agent.startedAt);
    return agent.owner;
  };

  const records = [];
  for (const agent of rawAgents) {
    const owner = ownerOf(agent);
    if (!owner) continue;
    let state = 'running';
    let endedAt = null;
    if (agent.thread.state === 'done') {
      state = OUTCOME_STATE[agent.thread.outcome] ?? 'completed';
      endedAt = agent.thread.at ?? agent.lastActivityAt;
    } else {
      const note = notifications.get(agent.id);
      if (note && (note.at ?? 0) >= agent.lastActivityAt - NOTIFICATION_TOLERANCE_MS) {
        state = NOTIFICATION_STATE[note.status] ?? 'stopped';
        endedAt = note.at ?? agent.lastActivityAt;
      }
    }
    records.push({
      ownerPid: owner.pid,
      id: agent.id,
      description: agent.description,
      agentType: agent.agentType,
      shape: agent.shape,
      depth: agent.depth,
      parentId: agent.parentId,
      model: agent.model,
      startedAt: agent.startedAt,
      lastActivityAt: agent.lastActivityAt,
      state,
      endedAt,
      activity: state === 'running' ? agent.thread.activity ?? null : null,
    });
  }
  return records;
}

/**
 * Turns the workflow runs of one session into records attributed to the live
 * process that runs them. An agent is settled by the run's journal, by its own
 * transcript ending, or by the run's task notification; a run is running while
 * any agent is, or briefly between phases until the run reports its end.
 */
export function resolveWorkflows(rawRuns, owners, notifications, now) {
  const sortedOwners = [...owners].sort((a, b) => a.startedAt - b.startedAt);
  const records = [];
  for (const run of rawRuns) {
    if (!run.agents.length) continue;
    const startedAt = Math.min(...run.agents.map((agent) => agent.startedAt));
    const owner = ownerAt(sortedOwners, startedAt);
    if (!owner) continue;
    const lastActivityAt = Math.max(...run.agents.map((agent) => agent.lastActivityAt));

    const note = notifications.get(run.taskId) ?? notifications.get(run.runId);
    let ended = null;
    if (note && (note.at ?? 0) >= lastActivityAt - NOTIFICATION_TOLERANCE_MS) {
      ended = { state: NOTIFICATION_STATE[note.status] ?? 'stopped', at: note.at };
    } else if (run.snapshot && NOTIFICATION_STATE[run.snapshot.status] && (run.snapshot.at ?? 0) >= startedAt) {
      ended = { state: NOTIFICATION_STATE[run.snapshot.status], at: run.snapshot.at };
    }

    const agents = run.agents.map((agent) => {
      let state = 'running';
      let endedAt = null;
      if (agent.journal?.status === 'completed' || agent.journal?.status === 'failed') {
        state = agent.journal.status;
        endedAt = agent.journal.at ?? agent.lastActivityAt;
      } else if (agent.thread.state === 'done') {
        state = OUTCOME_STATE[agent.thread.outcome] ?? 'completed';
        endedAt = agent.thread.at ?? agent.lastActivityAt;
      } else if (ended) {
        state = ended.state === 'completed' ? 'stopped' : ended.state;
        endedAt = ended.at ?? agent.lastActivityAt;
      }
      return {
        id: agent.id,
        description: agent.journal?.label || agent.description,
        phase: agent.journal?.phase ?? null,
        agentType: agent.agentType,
        model: agent.model,
        startedAt: agent.startedAt,
        lastActivityAt: agent.lastActivityAt,
        state,
        endedAt,
        activity: state === 'running' ? agent.thread.activity ?? null : null,
      };
    });

    const finished = agents.filter((agent) => agent.state !== 'running');
    let state = 'running';
    let endedAt = null;
    // The run's own report ends it; without one, every agent must have settled and the run gone quiet.
    const settled = finished.length === agents.length && !(run.journalPending > 0);
    if (ended || (settled && now - lastActivityAt > WORKFLOW_GAP_MS)) {
      state = ended?.state ?? (finished.some((agent) => agent.state === 'failed') ? 'failed' : 'completed');
      endedAt = ended?.at ?? Math.max(...finished.map((agent) => agent.endedAt ?? agent.lastActivityAt));
    }
    records.push({
      ownerPid: owner.pid,
      runId: run.runId,
      name: run.name,
      state,
      startedAt,
      lastActivityAt,
      endedAt,
      agentCount: Math.max(run.journalCount ?? 0, agents.length),
      finishedCount: finished.length,
      agents,
    });
  }
  return records;
}

export function createCollector(options = {}) {
  const deps = {
    listProcesses: procs.listProcesses,
    readStdoutTargets: procs.readStdoutTargets,
    readCwd: procs.readCwd,
    configDir: claudeConfigDir(),
    hostPid: Number(process.env.AGENT_MONITOR_HOST_PID) || process.ppid,
    platform: process.platform,
    home: os.homedir(),
    ...options,
  };
  const projectsDir = path.join(deps.configDir, 'projects');
  const index = new TranscriptIndex();
  const caches = { thread: new Map(), head: new Map(), meta: new Map(), journal: new Map() };
  const workflowNames = new Map();
  const transcriptPaths = new Map();

  // Memoizes `compute` per file until `version` changes.
  const memo = (cache, file, version, compute, now) => {
    const hit = cache.get(file);
    if (hit && hit.version === version) {
      hit.touched = now;
      return hit.value;
    }
    const value = compute();
    cache.set(file, { version, value, touched: now });
    return value;
  };

  const readSessionFile = (proc) => {
    const data = readJson(path.join(deps.configDir, 'sessions', `${proc.pid}.json`));
    if (!data || typeof data !== 'object') return null;
    if (data.pid !== undefined && data.pid !== proc.pid) return null;
    // A file older than the process was left behind by an earlier process with the same pid.
    if (proc.startedAt && typeof data.startedAt === 'number' && data.startedAt < proc.startedAt - 5000) return null;
    return data;
  };

  const resolveTranscript = (sessionId, cwd) => {
    const known = transcriptPaths.get(sessionId);
    if (known && fs.existsSync(known)) return known;
    const found = findTranscript(projectsDir, sessionId, cwd);
    if (found) transcriptPaths.set(sessionId, found);
    else transcriptPaths.delete(sessionId);
    return found;
  };

  // One agent transcript in `dir`, or null if it cannot be running in a live process.
  const readAgentFile = (dir, id, earliestStart, now) => {
    const file = path.join(dir, `agent-${id}.jsonl`);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    // Untouched since before every live process started: cannot be running in one.
    if (stat.mtimeMs < earliestStart - OWNER_TOLERANCE_MS) return null;

    const metaFile = path.join(dir, `agent-${id}.meta.json`);
    let metaVersion = 'missing';
    try {
      metaVersion = fs.statSync(metaFile).mtimeMs;
    } catch {
      // Older Claude Code versions, and workflow agents, may write no meta file.
    }
    const meta = memo(caches.meta, metaFile, metaVersion, () => readJson(metaFile), now) || {};
    const head = memo(caches.head, file, stat.ino, () => {
      const first = readFirstEntry(file);
      return { startedAt: parseTime(first?.timestamp), prompt: promptText(first) };
    }, now);
    const thread = memo(caches.thread, file, `${stat.size}:${stat.mtimeMs}`, () => readThreadState(file), now);
    const notes = index.update(file, now);

    return {
      notes,
      agent: {
        id,
        description: (typeof meta.description === 'string' && meta.description) || head.prompt || id,
        agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
        shape: typeof meta.requestShape === 'string' ? meta.requestShape : null,
        depth: Number.isInteger(meta.spawnDepth) ? meta.spawnDepth : meta.parentAgentId ? 2 : 1,
        parentId: typeof meta.parentAgentId === 'string' ? meta.parentAgentId : null,
        model: typeof meta.model === 'string' ? meta.model : null,
        startedAt: head.startedAt ?? (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs),
        lastActivityAt: stat.mtimeMs,
        thread,
      },
    };
  };

  // Agent transcripts in `dir`, named agent-<id>.jsonl.
  const readAgentDir = (dir, earliestStart, now) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return { agents: [], notificationStates: [] };
    }
    const agents = [];
    const notificationStates = [];
    for (const name of names) {
      const match = /^agent-(.+)\.jsonl$/.exec(name);
      if (!match) continue;
      const read = readAgentFile(dir, match[1], earliestStart, now);
      if (!read) continue;
      agents.push(read.agent);
      if (read.notes) notificationStates.push(read.notes);
    }
    return { agents, notificationStates };
  };

  const readAgents = (transcript, earliestStart, now) =>
    readAgentDir(path.join(transcript.slice(0, -'.jsonl'.length), 'subagents'), earliestStart, now);

  // A run's name: from its snapshot, or from its script, saved as <name>-<runId>.js.
  const workflowName = (sessionDir, runId, snapshot) => {
    if (typeof snapshot?.workflowName === 'string' && snapshot.workflowName) return snapshot.workflowName;
    if (workflowNames.has(runId)) return workflowNames.get(runId);
    let script = null;
    try {
      script = fs.readdirSync(path.join(sessionDir, 'workflows', 'scripts')).find((name) => name.endsWith(`-${runId}.js`));
    } catch {
      // No scripts folder.
    }
    if (!script) return runId;
    const name = script.slice(0, -`-${runId}.js`.length) || runId;
    workflowNames.set(runId, name);
    return name;
  };

  // Workflow runs, whose agents write to <session>/subagents/workflows/<runId>/.
  const readWorkflows = (transcript, earliestStart, now) => {
    const sessionDir = transcript.slice(0, -'.jsonl'.length);
    const runsDir = path.join(sessionDir, 'subagents', 'workflows');
    let runIds;
    try {
      runIds = fs.readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return { runs: [], notificationStates: [] };
    }
    const runs = [];
    const notificationStates = [];
    for (const runId of runIds) {
      const dir = path.join(runsDir, runId);
      const { agents, notificationStates: notes } = readAgentDir(dir, earliestStart, now);
      if (!agents.length) continue;
      notificationStates.push(...notes);

      const journalFile = path.join(dir, 'journal.jsonl');
      let journalVersion = 'missing';
      try {
        const stat = fs.statSync(journalFile);
        journalVersion = `${stat.size}:${stat.mtimeMs}`;
      } catch {
        // Not written yet.
      }
      const journal = memo(caches.journal, journalFile, journalVersion, () => readWorkflowJournal(journalFile), now);

      const snapshotFile = path.join(sessionDir, 'workflows', `${runId}.json`);
      let snapshotVersion = 'missing';
      try {
        snapshotVersion = fs.statSync(snapshotFile).mtimeMs;
      } catch {
        // Written when the run ends, if at all.
      }
      const snapshot = memo(caches.meta, snapshotFile, snapshotVersion, () => readJson(snapshotFile), now);

      runs.push({
        runId,
        taskId: typeof snapshot?.taskId === 'string' ? snapshot.taskId : runId,
        name: workflowName(sessionDir, runId, snapshot),
        snapshot: snapshot && typeof snapshot.status === 'string' ? { status: snapshot.status, at: parseTime(snapshot.timestamp) } : null,
        journalCount: journal.size,
        // Started in the journal but no transcript yet: running, about to write one.
        journalPending: [...journal].filter(([id, entry]) => entry.status === 'running' && !agents.some((agent) => agent.id === id)).length,
        agents: agents.map((agent) => ({ ...agent, journal: journal.get(agent.id) ?? null })),
      });
    }
    return { runs, notificationStates };
  };

  async function snapshot({ includeFinished = false, now = Date.now() } = {}) {
    const base = { generatedAt: now, platform: deps.platform, hostPid: deps.hostPid, home: deps.home };
    if (deps.platform === 'win32') return { ...base, supported: false, processes: [], summary: emptySummary() };

    const all = await deps.listProcesses(now);
    const byPid = new Map(all.map((proc) => [proc.pid, proc]));
    const children = new Map();
    for (const proc of all) {
      if (!children.has(proc.ppid)) children.set(proc.ppid, []);
      children.get(proc.ppid).push(proc);
    }
    const claudes = all.filter((proc) => !proc.zombie && procs.isClaudeProcess(proc));

    const shellsByOwner = new Map(
      claudes.map((proc) => [proc.pid, (children.get(proc.pid) || []).filter((child) => !child.zombie && procs.isToolShell(child.args))]),
    );
    const shellPids = [...shellsByOwner.values()].flat().map((shell) => shell.pid);
    const stdoutTargets = await deps.readStdoutTargets(shellPids, deps.platform).catch(() => new Map());

    const entries = [];
    for (const proc of claudes) {
      const session = readSessionFile(proc);
      const sessionId = (typeof session?.sessionId === 'string' && session.sessionId) || procs.sessionIdFromArgs(proc.args);
      const cwd = (typeof session?.cwd === 'string' && session.cwd) || (await deps.readCwd(proc.pid, deps.platform).catch(() => null));
      entries.push({ proc, session, sessionId, cwd });
    }

    const groups = new Map();
    for (const entry of entries) {
      const key = entry.sessionId || `pid:${entry.proc.pid}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }

    const output = [];
    for (const group of groups.values()) {
      const { sessionId, cwd } = group[0];
      const transcript = sessionId ? resolveTranscript(sessionId, cwd) : null;
      const info = transcript ? index.update(transcript, now) : null;
      let thread = { state: 'unknown' };
      let agents = [];
      let workflows = [];
      if (transcript) {
        let stat = null;
        try {
          stat = fs.statSync(transcript);
        } catch {
          // Removed between lookup and read.
        }
        if (stat) {
          thread = memo(caches.thread, transcript, `${stat.size}:${stat.mtimeMs}`, () => readThreadState(transcript, { mainThread: true }), now);
        }
        const owners = group.map((entry) => entry.proc).filter((proc) => proc.startedAt !== null);
        if (owners.length) {
          const earliest = Math.min(...owners.map((proc) => proc.startedAt));
          const { agents: rawAgents, notificationStates } = readAgents(transcript, earliest, now);
          const { runs, notificationStates: runNotes } = readWorkflows(transcript, earliest, now);
          const notifications = mergeNotifications([info, ...notificationStates, ...runNotes]);
          agents = resolveAgents(rawAgents, owners, notifications);
          workflows = resolveWorkflows(runs, owners, notifications, now);
        }
      }

      const newest = group.reduce((a, b) => ((b.proc.startedAt ?? 0) > (a.proc.startedAt ?? 0) ? b : a));
      for (const entry of group) {
        const { proc, session } = entry;
        const owned = agents.filter((agent) => agent.ownerPid === proc.pid);
        const running = owned.filter((agent) => agent.state === 'running').sort((a, b) => a.startedAt - b.startedAt);
        const finished = owned.filter((agent) => agent.state !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
        const ownedRuns = workflows.filter((run) => run.ownerPid === proc.pid);
        const runningRuns = ownedRuns.filter((run) => run.state === 'running').sort((a, b) => a.startedAt - b.startedAt);
        const finishedRuns = ownedRuns.filter((run) => run.state !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
        const runningRunAgents = runningRuns.flatMap((run) => run.agents.filter((agent) => agent.state === 'running'));
        // An older process of the same session was superseded by a newer turn.
        const turn = entry === newest ? thread : { state: 'done', outcome: 'superseded', at: null };

        // A shell is a foreground tool call while some thread waits on its command;
        // anything else was started in the background.
        const waiting = [
          ...(turn.state === 'active' ? pendingCommands(turn.activity).map((key) => ({ key, agentId: null })) : []),
          ...[...running, ...runningRunAgents].flatMap((agent) => pendingCommands(agent.activity).map((key) => ({ key, agentId: agent.id }))),
        ];
        const shells = (shellsByOwner.get(proc.pid) || []).map((shell) => {
          const command = procs.extractShellCommand(shell.args);
          const key = commandKey(command);
          const match = waiting.find((item) => item.key === key);
          return {
            pid: shell.pid,
            pgid: shell.pgid,
            startedAt: shell.startedAt,
            cpu: shell.cpu,
            command,
            background: !match,
            agentId: match?.agentId ?? null,
            taskId: procs.taskIdFromOutputPath(stdoutTargets.get(shell.pid)),
          };
        });

        let status = 'idle';
        if (turn.state === 'active') status = 'working';
        else if (running.length || runningRuns.length || shells.length) status = 'background';

        output.push({
          pid: proc.pid,
          ppid: proc.ppid,
          startedAt: proc.startedAt,
          cpu: proc.cpu,
          rssKb: proc.rssKb,
          origin: classifyOrigin(proc, byPid, deps.hostPid, session?.entrypoint),
          entrypoint: typeof session?.entrypoint === 'string' ? session.entrypoint : null,
          version: typeof session?.version === 'string' ? session.version : null,
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          title: info?.customTitle || info?.aiTitle || null,
          lastPrompt: info?.lastPrompt || null,
          transcriptFound: Boolean(transcript),
          status,
          turn: { state: turn.state, outcome: turn.outcome ?? null, at: turn.at ?? null, activity: publicActivity(turn.activity) },
          agents: running.map((agent) => ({ ...agent, activity: publicActivity(agent.activity) })),
          finishedAgents: includeFinished ? finished.slice(0, FINISHED_LIMIT) : [],
          finishedCount: finished.length,
          workflows: [...runningRuns, ...(includeFinished ? finishedRuns.slice(0, FINISHED_LIMIT) : [])].map((run) => publicRun(run, includeFinished)),
          finishedWorkflowCount: finishedRuns.length,
          shells,
        });
      }
    }

    output.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.startedAt ?? 0) - (a.startedAt ?? 0));

    index.prune(CACHE_IDLE_MS, now);
    for (const cache of Object.values(caches)) {
      for (const [file, hit] of cache) if (now - hit.touched > CACHE_IDLE_MS) cache.delete(file);
    }

    return { ...base, supported: true, processes: output, summary: summarize(output) };
  }

  return { snapshot, deps };
}

/** A workflow run as sent to the UI: finished agents only when asked for. */
function publicRun({ ownerPid, agents, ...run }, includeFinished) {
  const shown = agents
    .filter((agent) => includeFinished || agent.state === 'running')
    .sort((a, b) => (a.state === 'running') - (b.state === 'running') || a.startedAt - b.startedAt)
    .map((agent) => ({ ...agent, activity: publicActivity(agent.activity) }));
  return { ...run, agents: shown };
}

function mergeNotifications(states) {
  const merged = new Map();
  for (const state of states) {
    if (!state) continue;
    for (const [taskId, note] of state.notifications) {
      const previous = merged.get(taskId);
      if (!previous || (note.at ?? 0) >= (previous.at ?? 0)) merged.set(taskId, note);
    }
  }
  return merged;
}

function emptySummary() {
  return { processes: 0, background: 0, working: 0, runningAgents: 0, workflows: 0, shells: 0 };
}

function summarize(processes) {
  const summary = emptySummary();
  for (const proc of processes) {
    summary.processes += 1;
    if (proc.status === 'background') summary.background += 1;
    if (proc.status === 'working') summary.working += 1;
    const runningRuns = proc.workflows.filter((run) => run.state === 'running');
    summary.runningAgents += proc.agents.length + runningRuns.reduce((sum, run) => sum + run.agents.filter((agent) => agent.state === 'running').length, 0);
    summary.workflows += runningRuns.length;
    summary.shells += proc.shells.length;
  }
  return summary;
}
