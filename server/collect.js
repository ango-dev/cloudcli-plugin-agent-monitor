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
} from './transcripts.js';

// An agent belongs to the newest live process of its session that had started by then.
const OWNER_TOLERANCE_MS = 1500;
// A notification counts as final unless the agent wrote to its transcript after it.
const NOTIFICATION_TOLERANCE_MS = 2000;
const FINISHED_LIMIT = 20;
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

/**
 * Turns the agents of one session into records attributed to the live
 * process that runs them, with their state resolved.
 */
export function resolveAgents(rawAgents, owners, notifications) {
  const byId = new Map(rawAgents.map((agent) => [agent.id, agent]));
  const sortedOwners = [...owners].sort((a, b) => a.startedAt - b.startedAt);

  const ownerByTime = (startedAt) => {
    let owner = null;
    for (const proc of sortedOwners) {
      if (proc.startedAt <= startedAt + OWNER_TOLERANCE_MS) owner = proc;
    }
    return owner;
  };

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
  const caches = { thread: new Map(), head: new Map(), meta: new Map() };
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

  const readAgents = (transcript, earliestStart, now) => {
    const dir = path.join(transcript.slice(0, -'.jsonl'.length), 'subagents');
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
      const file = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      // Untouched since before every live process started: cannot be running in one.
      if (stat.mtimeMs < earliestStart - OWNER_TOLERANCE_MS) continue;

      const id = match[1];
      const metaFile = path.join(dir, `agent-${id}.meta.json`);
      let metaVersion = 'missing';
      try {
        metaVersion = fs.statSync(metaFile).mtimeMs;
      } catch {
        // Older Claude Code versions write no meta file.
      }
      const meta = memo(caches.meta, metaFile, metaVersion, () => readJson(metaFile), now) || {};
      const head = memo(caches.head, file, stat.ino, () => {
        const first = readFirstEntry(file);
        return { startedAt: parseTime(first?.timestamp), prompt: promptText(first) };
      }, now);
      const thread = memo(caches.thread, file, `${stat.size}:${stat.mtimeMs}`, () => readThreadState(file), now);
      const notes = index.update(file, now);
      if (notes) notificationStates.push(notes);

      agents.push({
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
      });
    }
    return { agents, notificationStates };
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
          const notifications = mergeNotifications([info, ...notificationStates]);
          agents = resolveAgents(rawAgents, owners, notifications);
        }
      }

      const newest = group.reduce((a, b) => ((b.proc.startedAt ?? 0) > (a.proc.startedAt ?? 0) ? b : a));
      for (const entry of group) {
        const { proc, session } = entry;
        const owned = agents.filter((agent) => agent.ownerPid === proc.pid);
        const running = owned.filter((agent) => agent.state === 'running').sort((a, b) => a.startedAt - b.startedAt);
        const finished = owned.filter((agent) => agent.state !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
        // An older process of the same session was superseded by a newer turn.
        const turn = entry === newest ? thread : { state: 'done', outcome: 'superseded', at: null };

        // A shell is a foreground tool call while some thread waits on its command;
        // anything else was started in the background.
        const waiting = [
          ...(turn.state === 'active' ? pendingCommands(turn.activity).map((key) => ({ key, agentId: null })) : []),
          ...running.flatMap((agent) => pendingCommands(agent.activity).map((key) => ({ key, agentId: agent.id }))),
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
        else if (running.length || shells.length) status = 'background';

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
  return { processes: 0, background: 0, working: 0, runningAgents: 0, shells: 0 };
}

function summarize(processes) {
  const summary = emptySummary();
  for (const proc of processes) {
    summary.processes += 1;
    if (proc.status === 'background') summary.background += 1;
    if (proc.status === 'working') summary.working += 1;
    summary.runningAgents += proc.agents.length;
    summary.shells += proc.shells.length;
  }
  return summary;
}
