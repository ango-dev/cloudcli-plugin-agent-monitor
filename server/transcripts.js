// Transcript readers: Claude Code's JSONL session and subagent transcripts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Stop reasons after which the model does not continue on its own.
const TERMINAL_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']);
const INTERRUPT_PREFIX = '[Request interrupted by user';
// User entries that record local bookkeeping rather than starting model work.
const BOOKKEEPING_TEXT = /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;

export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
}

/** Claude Code's project directory name for a working directory. */
export function projectDirName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Finds `<projects>/<project>/<sessionId>.jsonl`, falling back to a scan of every project. */
export function findTranscript(projectsDir, sessionId, cwd) {
  if (cwd) {
    const direct = path.join(projectsDir, projectDirName(cwd), `${sessionId}.jsonl`);
    if (fs.existsSync(direct)) return direct;
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const candidate = path.join(projectsDir, dir.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseTime(value) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function contentBlocks(message) {
  const content = message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

/** First text of a message, including text inside tool results. */
function leadingText(message) {
  for (const block of contentBlocks(message)) {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    if (block?.type === 'tool_result') {
      if (typeof block.content === 'string') return block.content;
      const inner = Array.isArray(block.content) ? block.content.find((b) => b?.type === 'text') : null;
      if (inner?.text) return inner.text;
    }
  }
  return '';
}

function isBookkeeping(entry) {
  if (entry.isMeta === true || entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) return true;
  return BOOKKEEPING_TEXT.test(leadingText(entry.message));
}

/** True for user and assistant entries that move the conversation forward. */
export function isConversational(entry, { mainThread = false } = {}) {
  if (entry?.type !== 'user' && entry?.type !== 'assistant') return false;
  if (mainThread && entry.isSidechain === true) return false;
  return !(entry.type === 'user' && isBookkeeping(entry));
}

function singleLine(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const DETAIL_KEYS = ['description', 'command', 'file_path', 'notebook_path', 'pattern', 'query', 'url', 'path', 'skill', 'subject', 'prompt'];

/**
 * Short label for a tool call: its name plus the most telling input field.
 * `command` keeps a Bash command whole so a running shell can be matched to it.
 */
export function summarizeToolUse(block) {
  const input = block?.input && typeof block.input === 'object' ? block.input : {};
  let detail = null;
  for (const key of DETAIL_KEYS) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      detail = singleLine(input[key], 140);
      break;
    }
  }
  const command = typeof input.command === 'string' ? input.command : null;
  return { name: String(block?.name || 'tool'), detail, command };
}

/**
 * Walks a JSONL file from the end, newest line first. `visit(entry)` returns
 * true to stop. Lines that do not parse (such as one still being written) are
 * skipped. Reads at most `maxBytes` from the end of the file.
 */
export function scanBackward(file, visit, { chunkSize = 256 * 1024, maxBytes = 16 * 1024 * 1024 } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  const visitLine = (bytes) => {
    if (!bytes.length) return false;
    let entry;
    try {
      entry = JSON.parse(bytes.toString('utf8'));
    } catch {
      return false;
    }
    return visit(entry) === true;
  };
  try {
    const size = fs.fstatSync(fd).size;
    let pos = size;
    let rest = Buffer.alloc(0);
    while (pos > 0 && size - pos < maxBytes) {
      const length = Math.min(chunkSize, pos);
      pos -= length;
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, pos);
      const buf = rest.length ? Buffer.concat([chunk, rest]) : chunk;
      let end = buf.length;
      let newline = buf.lastIndexOf(0x0a, end - 1);
      while (newline !== -1) {
        if (visitLine(buf.subarray(newline + 1, end))) return;
        end = newline;
        newline = end > 0 ? buf.lastIndexOf(0x0a, end - 1) : -1;
      }
      // Bytes before the first newline belong to a line that starts earlier.
      rest = buf.subarray(0, end);
    }
    if (pos === 0) visitLine(rest);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Reads where a transcript's thread currently stands from its newest entries.
 *
 * Returns `{ state: 'done', outcome, at }` once the thread has ended (a final
 * answer, an API error, or a user interruption), `{ state: 'active', activity,
 * at }` while it is still going, or `{ state: 'unknown' }` for an empty file.
 * `activity.kind` is `tool` (with the tool calls still awaiting results),
 * `thinking` (the model is producing its next step) or `responding`.
 */
export function readThreadState(file, { mainThread = false, maxBytes } = {}) {
  let last = null;
  let messageId = null;
  let inAssistant = false;
  const toolUses = [];
  const answered = new Set();
  let visited = 0;

  scanBackward(file, (entry) => {
    if (!isConversational(entry, { mainThread })) return false;
    if (++visited > 500) return true;
    if (!last) last = entry;

    if (entry.type === 'user') {
      if (inAssistant) return true;
      const results = contentBlocks(entry.message).filter((b) => b?.type === 'tool_result');
      if (!results.length) return true;
      for (const result of results) answered.add(result.tool_use_id);
      return false;
    }

    // Assistant: one entry per content block, all sharing the message id.
    if (!inAssistant) {
      inAssistant = true;
      messageId = entry.message?.id ?? null;
    } else if (!messageId || entry.message?.id !== messageId) {
      return true;
    }
    // Entries are visited newest first, so each one's calls go in front.
    toolUses.unshift(...contentBlocks(entry.message).filter((block) => block?.type === 'tool_use'));
    return !messageId;
  }, { maxBytes });

  if (!last) return { state: 'unknown' };
  const at = parseTime(last.timestamp);

  if (last.type === 'assistant') {
    if (TERMINAL_STOP_REASONS.has(last.message?.stop_reason)) {
      return { state: 'done', outcome: last.isApiErrorMessage === true ? 'error' : 'completed', at };
    }
  } else if (leadingText(last.message).startsWith(INTERRUPT_PREFIX)) {
    return { state: 'done', outcome: 'interrupted', at };
  }

  const pending = toolUses.filter((block) => !answered.has(block.id)).map(summarizeToolUse);
  if (pending.length) return { state: 'active', activity: { kind: 'tool', tools: pending }, at };
  if (last.type === 'assistant') return { state: 'active', activity: { kind: 'responding' }, at };
  return { state: 'active', activity: { kind: 'thinking' }, at };
}

/** First entry of a transcript (its opening prompt), or null. */
export function readFirstEntry(file, maxBytes = 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buf, 0, maxBytes, 0);
    const head = buf.subarray(0, read);
    const newline = head.indexOf(0x0a);
    const text = head.subarray(0, newline === -1 ? read : newline).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      // The opening line is longer than maxBytes: salvage its timestamp.
      const stamp = /"timestamp":"([^"]+)"/.exec(text);
      return stamp ? { timestamp: stamp[1] } : null;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Opening prompt text of a transcript, for agents that have no description. */
export function promptText(entry) {
  const text = leadingText(entry?.message);
  return text ? singleLine(text, 140) : null;
}

const NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g;

function tag(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? match[1].trim() : null;
}

/** Parses the task notifications Claude Code queues when background work stops. */
export function parseTaskNotifications(text) {
  const notes = [];
  for (const match of String(text).matchAll(NOTIFICATION_BLOCK)) {
    const taskId = tag(match[1], 'task-id');
    if (!taskId) continue;
    notes.push({ taskId, status: (tag(match[1], 'status') || 'unknown').toLowerCase(), toolUseId: tag(match[1], 'tool-use-id') });
  }
  return notes;
}

function textsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return [];
}

/**
 * Texts that carry real task notifications. Only entries Claude Code itself
 * writes for a notification count, so notification text quoted inside a tool
 * result or a message is never mistaken for one.
 */
export function notificationTexts(entry) {
  if (entry?.type === 'queue-operation') return textsOf(entry.content);
  if (entry?.type === 'user' && entry.origin?.kind === 'task-notification') return textsOf(entry.message?.content);
  if (entry?.type === 'attachment' && entry.attachment?.type === 'queued_command' && entry.attachment.commandMode === 'task-notification') {
    return textsOf(entry.attachment.prompt);
  }
  return [];
}

const TITLE_MARKERS = ['"type":"ai-title"', '"type":"custom-title"', '"type":"last-prompt"'];

/**
 * Follows transcripts as they grow, reading only appended bytes, and keeps
 * what is spread across the whole file: task notifications and the session
 * title and last prompt.
 */
export class TranscriptIndex {
  constructor({ chunkSize = 4 * 1024 * 1024 } = {}) {
    this.chunkSize = chunkSize;
    this.files = new Map();
  }

  update(file, now = Date.now()) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      this.files.delete(file);
      return null;
    }
    let state = this.files.get(file);
    if (!state || state.ino !== stat.ino || stat.size < state.offset) {
      state = {
        ino: stat.ino,
        offset: 0,
        decoder: new StringDecoder('utf8'),
        carry: '',
        notifications: new Map(),
        aiTitle: null,
        customTitle: null,
        lastPrompt: null,
        touched: 0,
      };
      this.files.set(file, state);
    }
    if (stat.size > state.offset) this.#consume(file, state, stat.size);
    state.touched = now;
    return state;
  }

  /** Drops files that have not been looked at for `maxIdleMs`. */
  prune(maxIdleMs, now = Date.now()) {
    for (const [file, state] of this.files) {
      if (now - state.touched > maxIdleMs) this.files.delete(file);
    }
  }

  #consume(file, state, size) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return;
    }
    try {
      const buf = Buffer.alloc(Math.min(this.chunkSize, size - state.offset));
      while (state.offset < size) {
        const read = fs.readSync(fd, buf, 0, Math.min(buf.length, size - state.offset), state.offset);
        if (read <= 0) break;
        state.offset += read;
        const lines = (state.carry + state.decoder.write(buf.subarray(0, read))).split('\n');
        state.carry = lines.pop();
        for (const line of lines) this.#line(state, line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  #line(state, line) {
    const hasNotification = line.includes('<task-notification>');
    const hasTitle = TITLE_MARKERS.some((marker) => line.includes(marker));
    if (!hasNotification && !hasTitle) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (hasNotification) {
      const at = parseTime(entry.timestamp);
      for (const text of notificationTexts(entry)) {
        for (const note of parseTaskNotifications(text)) {
          const previous = state.notifications.get(note.taskId);
          if (!previous || (at ?? 0) >= (previous.at ?? 0)) state.notifications.set(note.taskId, { ...note, at });
        }
      }
    }
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') state.aiTitle = entry.aiTitle;
    else if (entry.type === 'custom-title') {
      const title = entry.customTitle ?? entry.title;
      if (typeof title === 'string') state.customTitle = title;
    } else if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') state.lastPrompt = entry.lastPrompt;
  }
}
