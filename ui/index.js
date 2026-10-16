// Agent Monitor tab. cloudcli imports this module from a blob URL, so it has no imports of its own.

const POLL_MS = 4000;
const QUIET_AFTER_MS = 5 * 60 * 1000;
const CONFIRM_MS = 6000;
const NOTICE_MS = 8000;
const FINISHED_KEY = 'agent-monitor:show-finished';

// One block per language, keyed by its code. A new language only needs a block here.
const STRINGS = {
  en: {
    units: { s: 's', m: 'm', h: 'h', d: 'd' },
    title: 'Agents',
    subtitle: 'Claude Code processes with their background agents and shells',
    refresh: 'Refresh',
    showFinished: 'Show finished agents',
    updated: (ago) => `Updated ${ago} ago`,
    chipProcesses: 'Processes',
    chipBackground: 'In background',
    chipAgents: 'Agents running',
    chipWorkflows: 'Workflows',
    chipShells: 'Shells',
    status: { working: 'Working', background: 'Background', idle: 'Idle' },
    statusHint: {
      working: 'A turn is in progress.',
      background: 'The turn has ended, but work is still running.',
      idle: 'Nothing is running in this process.',
    },
    origin: { cloudcli: 'cloudcli', terminal: 'Terminal', ide: 'IDE', desktop: 'Desktop', sdk: 'SDK', unknown: 'Other' },
    up: (d) => `up ${d}`,
    memory: (mb) => `${mb} MB`,
    lastPrompt: 'Last prompt',
    untitled: 'Untitled session',
    unknownSession: 'Unknown session',
    noTranscript: 'No transcript found for this session.',
    agents: 'Agents',
    workflows: 'Workflows',
    workflowAgents: (done, total) => `${done} of ${total} agents finished`,
    shells: 'Shells',
    runningCount: (n) => `${n} running`,
    finishedCount: (n) => `${n} finished`,
    noRunningAgents: 'No agents running.',
    moreFinished: (n) => `${n} more finished`,
    moreFinishedWorkflows: (n) => `${n} more finished workflows`,
    state: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      interrupted: 'Interrupted',
      killed: 'Stopped',
      stopped: 'Stopped',
    },
    shape: { background: 'background', foreground: 'foreground' },
    viaParent: (name) => `from ${name}`,
    started: (ago) => `started ${ago} ago`,
    ended: (ago) => `ended ${ago} ago`,
    lastActivity: (ago) => `active ${ago} ago`,
    quiet: (d) => `quiet for ${d}`,
    now: 'Now',
    thinking: 'Thinking',
    responding: 'Writing',
    moreTools: (n) => `+${n} more`,
    shellBackground: 'background',
    shellForeground: 'current tool call',
    shellOfAgent: (name) => `tool call of ${name}`,
    task: (id) => `task ${id}`,
    runningFor: (d) => `running ${d}`,
    stop: 'Stop',
    confirmStop: 'Click again to stop',
    stopping: 'Stopping...',
    stopProcessHint:
      'Stops this Claude process together with its background agents and shells. cloudcli may show an error in that chat.',
    stopShellHint: 'Stops this command and the processes it started.',
    stopped: (pid) => `Stopped PID ${pid}.`,
    killed: (pid) => `PID ${pid} ignored SIGTERM and was killed.`,
    stopFailed: (message) => `Could not stop: ${message}`,
    empty: 'No Claude Code processes are running.',
    emptyHint: 'Sessions show up here while they work, and afterwards for as long as background work keeps them alive.',
    loading: 'Loading...',
    loadFailed: (message) => `Could not load status: ${message}`,
    unsupported: 'Agent Monitor needs macOS or Linux.',
  },
  ko: {
    units: { s: '초', m: '분', h: '시간', d: '일' },
    title: '에이전트',
    subtitle: 'Claude Code 프로세스와 그 백그라운드 에이전트, 셸',
    refresh: '새로고침',
    showFinished: '끝난 에이전트 보기',
    updated: (ago) => `${ago} 전 갱신`,
    chipProcesses: '프로세스',
    chipBackground: '백그라운드',
    chipAgents: '실행 중 에이전트',
    chipWorkflows: '워크플로',
    chipShells: '셸',
    status: { working: '작업 중', background: '백그라운드', idle: '대기' },
    statusHint: {
      working: '턴이 진행 중입니다.',
      background: '턴은 끝났지만 작업이 계속 돌고 있습니다.',
      idle: '이 프로세스에서 돌고 있는 작업이 없습니다.',
    },
    origin: { cloudcli: 'cloudcli', terminal: '터미널', ide: 'IDE', desktop: '데스크톱', sdk: 'SDK', unknown: '기타' },
    up: (d) => `${d}째 실행`,
    memory: (mb) => `${mb} MB`,
    lastPrompt: '마지막 요청',
    untitled: '제목 없는 세션',
    unknownSession: '세션을 알 수 없음',
    noTranscript: '이 세션의 대화 기록을 찾지 못했습니다.',
    agents: '에이전트',
    workflows: '워크플로',
    workflowAgents: (done, total) => `에이전트 ${total}개 중 ${done}개 완료`,
    shells: '셸',
    runningCount: (n) => `${n}개 실행 중`,
    finishedCount: (n) => `${n}개 종료`,
    noRunningAgents: '실행 중인 에이전트가 없습니다.',
    moreFinished: (n) => `끝난 에이전트 ${n}개 더 있음`,
    moreFinishedWorkflows: (n) => `끝난 워크플로 ${n}개 더 있음`,
    state: {
      running: '실행 중',
      completed: '완료',
      failed: '실패',
      interrupted: '중단됨',
      killed: '중지됨',
      stopped: '중지됨',
    },
    shape: { background: '백그라운드', foreground: '포그라운드' },
    viaParent: (name) => `${name}에서 실행`,
    started: (ago) => `${ago} 전 시작`,
    ended: (ago) => `${ago} 전 종료`,
    lastActivity: (ago) => `${ago} 전 활동`,
    quiet: (d) => `${d}째 활동 없음`,
    now: '현재',
    thinking: '생각 중',
    responding: '답변 작성 중',
    moreTools: (n) => `외 ${n}개`,
    shellBackground: '백그라운드',
    shellForeground: '현재 도구 호출',
    shellOfAgent: (name) => `${name}의 도구 호출`,
    task: (id) => `작업 ${id}`,
    runningFor: (d) => `${d}째 실행 중`,
    stop: '중지',
    confirmStop: '한 번 더 누르면 중지',
    stopping: '중지하는 중',
    stopProcessHint:
      '이 Claude 프로세스를 중지합니다. 백그라운드 에이전트와 셸도 함께 끝납니다. cloudcli의 해당 채팅에 오류 메시지가 표시될 수 있습니다.',
    stopShellHint: '이 명령과 이 명령이 띄운 프로세스를 중지합니다.',
    stopped: (pid) => `PID ${pid}를 중지했습니다.`,
    killed: (pid) => `PID ${pid}가 SIGTERM에 응답하지 않아 강제로 종료했습니다.`,
    stopFailed: (message) => `중지하지 못했습니다: ${message}`,
    empty: '실행 중인 Claude Code 프로세스가 없습니다.',
    emptyHint: '세션이 작업하는 동안, 그리고 턴이 끝난 뒤에도 백그라운드 작업이 남아 있는 동안 여기에 표시됩니다.',
    loading: '불러오는 중',
    loadFailed: (message) => `상태를 불러오지 못했습니다: ${message}`,
    unsupported: '에이전트 모니터는 macOS와 Linux에서만 동작합니다.',
  },
};

// Colours come from the host's theme variables, which are HSL triplets (used as hsl(var(--x))).
// Each has a fallback for the light or dark theme so the tab still works on a host without them.
// Status colours have no host variable apart from --destructive, so they are tuned here.
const STYLE = `
.am-root {
  --am-bg: var(--background, 60 14.3% 98.6%);
  --am-text: var(--foreground, 60 2.6% 7.6%);
  --am-surface: var(--card, 0 0% 100%);
  --am-subtle: var(--muted, 60 3.2% 93.9%);
  --am-muted: var(--muted-foreground, 50 2.9% 40.8%);
  --am-hover: var(--accent, 48 12.2% 92%);
  --am-border: var(--border, 60 1.7% 88.4%);
  --am-input: var(--input, 60 1.5% 87.3%);
  --am-ring: var(--ring, 15.1 55.6% 52.4%);
  --am-primary: var(--primary, 15.5 58.2% 43.1%);
  --am-danger: var(--destructive, 4.1 59.1% 44.1%);
  --am-on-danger: var(--destructive-foreground, 0 0% 100%);
  --am-info: var(--link, 218.4 61.3% 43.5%);
  --am-success: 145 63% 28%;
  --am-warning: 32 92% 33%;
  --am-radius: var(--radius, 0.625rem);
  --am-sans: Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
  --am-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  background: hsl(var(--am-bg));
  color: hsl(var(--am-text));
  font: 13px/1.5 var(--am-sans);
}
.am-root.am-dark {
  --am-bg: var(--background, 0 0% 8.2%);
  --am-text: var(--foreground, 45 11.8% 93.3%);
  --am-surface: var(--card, 60 1.6% 12.4%);
  --am-subtle: var(--muted, 0 0% 12.9%);
  --am-muted: var(--muted-foreground, 45 3.6% 56.1%);
  --am-hover: var(--accent, 0 1.2% 16.7%);
  --am-border: var(--border, 0 1.2% 15.9%);
  --am-input: var(--input, 30 1.9% 21.2%);
  --am-ring: var(--ring, 15.2 64.9% 63.1%);
  --am-primary: var(--primary, 15.2 64.9% 63.1%);
  --am-danger: var(--destructive, 9.9 72.5% 67.3%);
  --am-on-danger: var(--destructive-foreground, 40 5.7% 10.4%);
  --am-info: var(--link, 217.1 88.7% 75.7%);
  --am-success: 142 42% 56%;
  --am-warning: 36 72% 60%;
}
.am-root *, .am-root *::before, .am-root *::after { box-sizing: border-box; }
.am-top { position: sticky; top: 0; z-index: 1; background: hsl(var(--am-bg)); }
.am-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 12px 16px; border-bottom: 1px solid hsl(var(--am-border) / 0.6); }
.am-heading { min-width: 0; }
.am-title-row { display: flex; align-items: center; gap: 8px; }
.am-title-row svg { flex: none; width: 16px; height: 16px; color: hsl(var(--am-primary)); }
.am-header h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.am-header p { margin: 2px 0 0; color: hsl(var(--am-muted)); font-size: 12px; }
.am-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.am-toggle { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; color: hsl(var(--am-muted)); font-size: 12px; cursor: pointer; user-select: none; }
.am-toggle input { margin: 0; accent-color: hsl(var(--am-primary)); }
.am-btn {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px;
  border: 1px solid hsl(var(--am-input)); background: hsl(var(--am-bg)); color: hsl(var(--am-text));
  border-radius: calc(var(--am-radius) - 2px); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: background-color 0.15s, color 0.15s;
}
.am-btn:hover { background: hsl(var(--am-hover)); }
.am-btn:focus-visible, .am-toggle input:focus-visible { outline: none; box-shadow: 0 0 0 1px hsl(var(--am-ring)); }
.am-btn:disabled { opacity: 0.5; cursor: default; }
.am-btn-icon { width: 28px; padding: 0; border-color: transparent; background: transparent; }
.am-btn-icon svg { width: 14px; height: 14px; }
.am-refreshing .am-btn-icon svg { animation: am-spin 0.8s linear infinite; }
.am-btn-danger { color: hsl(var(--am-danger)); }
.am-btn-confirm { background: hsl(var(--am-danger)); border-color: transparent; color: hsl(var(--am-on-danger)); }
.am-btn-confirm:hover { background: hsl(var(--am-danger) / 0.9); }
.am-summary {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: 8px 16px; font-size: 12px; color: hsl(var(--am-muted));
  border-bottom: 1px solid hsl(var(--am-border) / 0.6); background: linear-gradient(hsl(var(--am-subtle) / 0.2), hsl(var(--am-subtle) / 0.2)) hsl(var(--am-bg));
}
.am-stat b { color: hsl(var(--am-text)); font-weight: 600; margin-left: 4px; }
.am-stat-hot b { color: hsl(var(--am-warning)); }
.am-updated { margin-left: auto; }
.am-banner { padding: 8px 16px; border-bottom: 1px solid hsl(var(--am-tone) / 0.2); background: linear-gradient(hsl(var(--am-tone) / 0.1), hsl(var(--am-tone) / 0.1)) hsl(var(--am-bg)); color: hsl(var(--am-tone)); }
.am-banner-error { --am-tone: var(--am-danger); }
.am-banner-ok { --am-tone: var(--am-success); }
.am-content { padding: 12px 16px 32px; }
.am-empty { text-align: center; padding: 48px 16px; color: hsl(var(--am-muted)); }
.am-empty strong { display: block; color: hsl(var(--am-text)); font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.am-card { border: 1px solid hsl(var(--am-border)); border-radius: var(--am-radius); background: hsl(var(--am-surface)); padding: 12px 14px; margin-bottom: 12px; }
.am-card.am-status-background { border-left: 3px solid hsl(var(--am-warning)); }
.am-card.am-status-working { border-left: 3px solid hsl(var(--am-info)); }
.am-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.am-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.am-name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.am-badge {
  display: inline-flex; align-items: center; border-radius: calc(var(--am-radius) - 2px); padding: 0 6px; line-height: 18px; font-size: 11px; font-weight: 600; white-space: nowrap;
  border: 1px solid hsl(var(--am-tone) / 0.3); background: hsl(var(--am-tone) / 0.08); color: hsl(var(--am-tone));
}
.am-badge-working { --am-tone: var(--am-info); }
.am-badge-background { --am-tone: var(--am-warning); }
.am-badge-idle { border-color: hsl(var(--am-input)); background: hsl(var(--am-subtle)); color: hsl(var(--am-muted)); }
.am-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: hsl(var(--am-muted)); margin-top: 4px; font-size: 12px; }
.am-meta .am-strong { color: hsl(var(--am-text)); }
.am-mono { font-family: var(--am-mono); font-size: 11.5px; }
.am-hint { color: hsl(var(--am-muted)); font-size: 12px; margin-top: 2px; }
.am-warn { color: hsl(var(--am-warning)); font-size: 12px; margin-top: 6px; }
.am-prompt { margin-top: 6px; color: hsl(var(--am-muted)); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-prompt b { color: hsl(var(--am-text)); font-weight: 500; margin-right: 6px; }
.am-section { margin-top: 10px; border-top: 1px solid hsl(var(--am-border)); padding-top: 8px; }
.am-section-title { font-size: 12px; font-weight: 500; color: hsl(var(--am-muted)); text-transform: uppercase; letter-spacing: 0.04em; display: flex; gap: 8px; align-items: baseline; }
.am-section-title span { text-transform: none; letter-spacing: 0; font-weight: 400; }
.am-list { list-style: none; margin: 6px 0 0; padding: 0; }
.am-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
.am-item + .am-item { border-top: 1px solid hsl(var(--am-border)); }
.am-item-body { min-width: 0; flex: 1; }
.am-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; }
.am-line + .am-line { margin-top: 1px; }
.am-desc { font-weight: 500; overflow-wrap: anywhere; }
.am-sub { color: hsl(var(--am-muted)); font-size: 12px; }
.am-activity { color: hsl(var(--am-text)); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.am-activity code, .am-cmd { font-family: var(--am-mono); font-size: 11.5px; }
.am-cmd { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-tag { font-size: 10.5px; line-height: 16px; color: hsl(var(--am-muted)); border: 1px solid hsl(var(--am-border)); background: hsl(var(--am-bg)); border-radius: calc(var(--am-radius) - 4px); padding: 0 5px; white-space: nowrap; }
.am-tag-bg { color: hsl(var(--am-warning)); border-color: hsl(var(--am-warning) / 0.4); }
.am-quiet { color: hsl(var(--am-warning)); }
.am-now { margin-top: 6px; flex-wrap: nowrap; }
.am-label { flex: none; font-size: 11px; color: hsl(var(--am-muted)); text-transform: uppercase; letter-spacing: 0.04em; }
.am-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; margin: 7px 1px 0; background: hsl(var(--am-muted) / 0.5); }
.am-state-running > .am-dot, .am-dot-shell { background: hsl(var(--am-success)); box-shadow: 0 0 0 0 hsl(var(--am-success)); animation: am-pulse 1.8s ease-out infinite; }
.am-state-completed > .am-dot { background: hsl(var(--am-muted) / 0.5); }
.am-state-failed > .am-dot { background: hsl(var(--am-danger)); }
.am-state-interrupted > .am-dot, .am-state-killed > .am-dot, .am-state-stopped > .am-dot { background: hsl(var(--am-warning)); }
.am-state-done > .am-item-body > .am-line > .am-desc { color: hsl(var(--am-muted)); font-weight: 400; }
.am-children { border-left: 1px solid hsl(var(--am-border)); margin-left: 3px; padding-left: 12px; }
@keyframes am-pulse { 0% { box-shadow: 0 0 0 0 hsl(var(--am-success) / 0.45); } 70% { box-shadow: 0 0 0 5px hsl(var(--am-success) / 0); } 100% { box-shadow: 0 0 0 0 hsl(var(--am-success) / 0); } }
@keyframes am-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .am-state-running > .am-dot, .am-dot-shell, .am-refreshing .am-btn-icon svg { animation: none; } }
`;

// Lucide icons, drawn inline so the tab makes no requests of its own. ACTIVITY_ICON matches icon.svg.
const ACTIVITY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 20 9 4 6 12 2 12"/></svg>';
const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';

/** CloudCLI's language setting (or the browser's), matched to a STRINGS block. */
function detectLanguage() {
  let preferred = null;
  try {
    preferred = JSON.parse(localStorage.getItem('user-preferences') || 'null')?.userLanguage ?? null;
  } catch {
    // Not available; fall back to the browser language.
  }
  const wanted = String(preferred || navigator.language || 'en').toLowerCase();
  const codes = Object.keys(STRINGS);
  return (
    codes.find((code) => code.toLowerCase() === wanted) ||
    codes.find((code) => code.toLowerCase() === wanted.split('-')[0]) ||
    'en'
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function clip(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function duration(ms, t) {
  const u = t.units;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}${u.s}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${u.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}${u.h} ${minutes % 60}${u.m}` : `${hours}${u.h}`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}${u.d} ${hours % 24}${u.h}` : `${days}${u.d}`;
}

function shortPath(file, home) {
  if (!file) return '';
  if (home && (file === home || file.startsWith(`${home}/`))) return `~${file.slice(home.length)}`;
  return file;
}

/** A path inside the session's folder relative to it, one under home with ~, anything else as is. */
function displayPath(text, cwd, home) {
  if (cwd && text.startsWith(`${cwd}/`)) return text.slice(cwd.length + 1);
  return shortPath(text, home);
}

// ---- rendering ---------------------------------------------------------------

function stopButton(view, kind, rawPid) {
  const { t, state } = view;
  const pid = Number(rawPid);
  const key = `${kind}:${pid}`;
  if (state.stopping.has(key)) return `<button type="button" class="am-btn" disabled>${escapeHtml(t.stopping)}</button>`;
  const confirming = state.confirm?.key === key;
  const cls = confirming ? 'am-btn am-btn-confirm' : 'am-btn am-btn-danger';
  const label = confirming ? t.confirmStop : t.stop;
  return `<button type="button" class="${cls}" data-action="stop" data-kind="${kind}" data-pid="${pid}">${escapeHtml(label)}</button>`;
}

function activityText(view, activity, cwd) {
  const { t } = view;
  if (!activity) return '';
  if (activity.kind === 'thinking') return escapeHtml(t.thinking);
  if (activity.kind === 'responding') return escapeHtml(t.responding);
  if (activity.kind === 'tool' && activity.tools?.length) {
    const [first, ...rest] = activity.tools;
    const detail = first.detail ? ` <code>${escapeHtml(displayPath(first.detail, cwd, view.state.data?.home))}</code>` : '';
    const more = rest.length ? ` <span class="am-sub">${escapeHtml(t.moreTools(rest.length))}</span>` : '';
    return `${escapeHtml(first.name)}${detail}${more}`;
  }
  return '';
}

function agentItem(view, agent, children, shownIds, cwd) {
  const { t, now } = view;
  const running = agent.state === 'running';
  const tags = [];
  if (agent.shape) {
    const cls = agent.shape === 'background' ? 'am-tag am-tag-bg' : 'am-tag';
    tags.push(`<span class="${cls}">${escapeHtml(t.shape[agent.shape] ?? agent.shape)}</span>`);
  }
  if (agent.phase) tags.push(`<span class="am-tag">${escapeHtml(agent.phase)}</span>`);
  // The default type adds nothing; name only the specialised ones.
  if (agent.agentType && agent.agentType !== 'general-purpose') tags.push(`<span class="am-tag">${escapeHtml(agent.agentType)}</span>`);
  if (agent.model) tags.push(`<span class="am-tag">${escapeHtml(agent.model)}</span>`);
  if (agent.parentId && !shownIds.has(agent.parentId) && agent.parentDescription) {
    tags.push(`<span class="am-sub">${escapeHtml(t.viaParent(clip(agent.parentDescription, 40)))}</span>`);
  }

  const timing = [`<span>${escapeHtml(t.started(duration(now - agent.startedAt, t)))}</span>`];
  let status;
  if (running) {
    const idle = now - agent.lastActivityAt;
    timing.push(
      idle > QUIET_AFTER_MS
        ? `<span class="am-quiet">${escapeHtml(t.quiet(duration(idle, t)))}</span>`
        : `<span>${escapeHtml(t.lastActivity(duration(idle, t)))}</span>`,
    );
    status = activityText(view, agent.activity, cwd);
  } else {
    const endedAt = agent.endedAt ?? agent.lastActivityAt;
    status = escapeHtml(t.state[agent.state] ?? agent.state);
    timing.push(`<span>${escapeHtml(t.ended(duration(now - endedAt, t)))}</span>`);
  }

  const stateClass = running ? 'am-state-running' : `am-state-done am-state-${escapeHtml(agent.state)}`;
  return `
    <li class="am-item ${stateClass}">
      <span class="am-dot" title="${escapeHtml(t.state[agent.state] ?? agent.state)}"></span>
      <div class="am-item-body">
        <div class="am-line"><span class="am-desc">${escapeHtml(agent.description)}</span>${tags.join('')}</div>
        ${status ? `<div class="am-line"><span class="am-activity">${status}</span></div>` : ''}
        <div class="am-line am-sub">${timing.join('')}</div>
        ${children}
      </div>
    </li>`;
}

function agentTree(view, agents, cwd) {
  const shownIds = new Set(agents.map((agent) => agent.id));
  const descriptions = new Map(agents.map((agent) => [agent.id, agent.description]));
  const childrenOf = new Map();
  const roots = [];
  for (const agent of agents) {
    if (agent.parentId && shownIds.has(agent.parentId) && agent.parentId !== agent.id) {
      if (!childrenOf.has(agent.parentId)) childrenOf.set(agent.parentId, []);
      childrenOf.get(agent.parentId).push(agent);
    } else {
      roots.push(agent);
    }
  }
  const visited = new Set();
  const renderAgent = (agent) => {
    if (visited.has(agent.id)) return '';
    visited.add(agent.id);
    const kids = (childrenOf.get(agent.id) || []).map(renderAgent).join('');
    const children = kids ? `<ul class="am-list am-children">${kids}</ul>` : '';
    return agentItem(view, { ...agent, parentDescription: descriptions.get(agent.parentId) }, children, shownIds, cwd);
  };
  return roots.map(renderAgent).join('');
}

function workflowItem(view, run, cwd) {
  const { t, now } = view;
  const running = run.state === 'running';
  const timing = [`<span>${escapeHtml(t.started(duration(now - run.startedAt, t)))}</span>`];
  if (running) timing.push(`<span>${escapeHtml(t.lastActivity(duration(now - run.lastActivityAt, t)))}</span>`);
  else timing.push(`<span>${escapeHtml(t.state[run.state] ?? run.state)}</span>`, `<span>${escapeHtml(t.ended(duration(now - (run.endedAt ?? run.lastActivityAt), t)))}</span>`);
  const agents = run.agents.map((agent) => agentItem(view, agent, '', new Set(), cwd)).join('');
  const stateClass = running ? 'am-state-running' : `am-state-done am-state-${escapeHtml(run.state)}`;
  return `
    <li class="am-item ${stateClass}">
      <span class="am-dot" title="${escapeHtml(t.state[run.state] ?? run.state)}"></span>
      <div class="am-item-body">
        <div class="am-line"><span class="am-desc">${escapeHtml(run.name)}</span><span class="am-sub">${escapeHtml(t.workflowAgents(run.finishedCount, run.agentCount))}</span></div>
        <div class="am-line am-sub">${timing.join('')}</div>
        ${agents ? `<ul class="am-list am-children">${agents}</ul>` : ''}
      </div>
    </li>`;
}

function shellItem(view, shell, agentNames) {
  const { t, now } = view;
  const owner = shell.agentId ? agentNames.get(shell.agentId) : null;
  let kind;
  if (shell.background) kind = `<span class="am-tag am-tag-bg">${escapeHtml(t.shellBackground)}</span>`;
  else if (shell.agentId) kind = `<span class="am-tag">${escapeHtml(t.shellOfAgent(clip(owner || shell.agentId, 40)))}</span>`;
  else kind = `<span class="am-tag">${escapeHtml(t.shellForeground)}</span>`;
  const meta = [
    kind,
    shell.taskId ? `<span class="am-mono">${escapeHtml(t.task(shell.taskId))}</span>` : '',
    shell.startedAt ? `<span>${escapeHtml(t.runningFor(duration(now - shell.startedAt, t)))}</span>` : '',
    `<span class="am-mono">PID ${Number(shell.pid)}</span>`,
  ].join('');
  const command = String(shell.command || '');
  const firstLine = command.split('\n').find((line) => line.trim()) || command;
  const confirming = view.state.confirm?.key === `shell:${shell.pid}`;
  return `
    <li class="am-item">
      <span class="am-dot am-dot-shell"></span>
      <div class="am-item-body">
        <div class="am-line"><code class="am-cmd" title="${escapeHtml(command)}">${escapeHtml(firstLine)}</code></div>
        <div class="am-line am-sub">${meta}</div>
        ${confirming ? `<div class="am-hint">${escapeHtml(t.stopShellHint)}</div>` : ''}
      </div>
      ${stopButton(view, 'shell', shell.pid)}
    </li>`;
}

function processCard(view, proc, home) {
  const { t, now, state } = view;
  const title = proc.title || (proc.lastPrompt ? clip(proc.lastPrompt, 100) : null) || (proc.sessionId ? t.untitled : t.unknownSession);
  const meta = [
    `<span class="am-strong">${escapeHtml(t.origin[proc.origin] ?? proc.origin)}</span>`,
    proc.cwd ? `<span title="${escapeHtml(proc.cwd)}">${escapeHtml(shortPath(proc.cwd, home))}</span>` : '',
    `<span class="am-mono">PID ${Number(proc.pid)}</span>`,
    proc.startedAt ? `<span>${escapeHtml(t.up(duration(now - proc.startedAt, t)))}</span>` : '',
    Number.isFinite(proc.cpu) ? `<span>CPU ${proc.cpu.toFixed(1)}%</span>` : '',
    Number.isFinite(proc.rssKb) ? `<span>${escapeHtml(t.memory(Math.round(proc.rssKb / 1024)))}</span>` : '',
    proc.version ? `<span class="am-mono">v${escapeHtml(proc.version)}</span>` : '',
  ].join('');

  const agents = [...proc.agents, ...(state.showFinished ? proc.finishedAgents : [])];
  const hiddenFinished = state.showFinished ? proc.finishedCount - proc.finishedAgents.length : 0;
  const agentCounts = [`<span>${escapeHtml(t.runningCount(proc.agents.length))}</span>`];
  if (proc.finishedCount) agentCounts.push(`<span>${escapeHtml(t.finishedCount(proc.finishedCount))}</span>`);
  const agentSection =
    agents.length || proc.finishedCount
      ? `<div class="am-section">
          <div class="am-section-title">${escapeHtml(t.agents)} ${agentCounts.join('')}</div>
          ${agents.length ? `<ul class="am-list">${agentTree(view, agents, proc.cwd)}</ul>` : `<div class="am-hint">${escapeHtml(t.noRunningAgents)}</div>`}
          ${hiddenFinished > 0 ? `<div class="am-hint">${escapeHtml(t.moreFinished(hiddenFinished))}</div>` : ''}
        </div>`
      : '';

  const workflows = proc.workflows ?? [];
  const runningRuns = workflows.filter((run) => run.state === 'running');
  const hiddenRuns = state.showFinished ? (proc.finishedWorkflowCount ?? 0) - (workflows.length - runningRuns.length) : 0;
  const runCounts = [`<span>${escapeHtml(t.runningCount(runningRuns.length))}</span>`];
  if (proc.finishedWorkflowCount) runCounts.push(`<span>${escapeHtml(t.finishedCount(proc.finishedWorkflowCount))}</span>`);
  const workflowSection = workflows.length
    ? `<div class="am-section">
        <div class="am-section-title">${escapeHtml(t.workflows)} ${runCounts.join('')}</div>
        <ul class="am-list">${workflows.map((run) => workflowItem(view, run, proc.cwd)).join('')}</ul>
        ${hiddenRuns > 0 ? `<div class="am-hint">${escapeHtml(t.moreFinishedWorkflows(hiddenRuns))}</div>` : ''}
      </div>`
    : '';

  const agentNames = new Map([
    ...proc.agents.map((agent) => [agent.id, agent.description]),
    ...workflows.flatMap((run) => run.agents.map((agent) => [agent.id, agent.description])),
  ]);
  const shellSection = proc.shells.length
    ? `<div class="am-section">
        <div class="am-section-title">${escapeHtml(t.shells)} <span>${escapeHtml(t.runningCount(proc.shells.length))}</span></div>
        <ul class="am-list">${proc.shells.map((shell) => shellItem(view, shell, agentNames)).join('')}</ul>
      </div>`
    : '';

  const turnActivity = proc.status === 'working' ? activityText(view, proc.turn.activity, proc.cwd) : '';
  const confirming = state.confirm?.key === `process:${proc.pid}`;
  return `
    <section class="am-card am-status-${escapeHtml(proc.status)}">
      <div class="am-card-head">
        <div>
          <div class="am-card-title">
            <span class="am-badge am-badge-${escapeHtml(proc.status)}" title="${escapeHtml(t.statusHint[proc.status] ?? '')}">${escapeHtml(t.status[proc.status] ?? proc.status)}</span>
            <span class="am-name">${escapeHtml(title)}</span>
          </div>
          <div class="am-meta">${meta}</div>
        </div>
        ${stopButton(view, 'process', proc.pid)}
      </div>
      ${confirming ? `<div class="am-hint">${escapeHtml(t.stopProcessHint)}</div>` : ''}
      ${turnActivity ? `<div class="am-line am-now"><span class="am-label">${escapeHtml(t.now)}</span><span class="am-activity">${turnActivity}</span></div>` : ''}
      ${proc.lastPrompt && proc.title ? `<div class="am-prompt" title="${escapeHtml(proc.lastPrompt)}"><b>${escapeHtml(t.lastPrompt)}</b>${escapeHtml(clip(proc.lastPrompt, 300))}</div>` : ''}
      ${proc.sessionId && !proc.transcriptFound ? `<div class="am-warn">${escapeHtml(t.noTranscript)}</div>` : ''}
      ${agentSection}
      ${workflowSection}
      ${shellSection}
    </section>`;
}

function render(view) {
  if (view.disposed) return;
  view.lang = detectLanguage();
  view.t = STRINGS[view.lang];
  view.now = Date.now();
  const { t, state } = view;
  const data = state.data;

  // The host passes its theme in the context and also marks <html> with "dark".
  const theme = view.api.context?.theme ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  view.root.classList.toggle('am-dark', theme === 'dark');

  const top = [];
  top.push(`
    <header class="am-header">
      <div class="am-heading">
        <div class="am-title-row">${ACTIVITY_ICON}<h2>${escapeHtml(t.title)}</h2></div>
        <p>${escapeHtml(t.subtitle)}</p>
      </div>
      <div class="am-actions">
        <label class="am-toggle"><input type="checkbox" data-action="toggle-finished" ${state.showFinished ? 'checked' : ''}>${escapeHtml(t.showFinished)}</label>
        <button type="button" class="am-btn am-btn-icon" data-action="refresh" title="${escapeHtml(t.refresh)}" aria-label="${escapeHtml(t.refresh)}">${REFRESH_ICON}</button>
      </div>
    </header>`);

  if (data?.supported) {
    const s = data.summary;
    top.push(`
      <div class="am-summary">
        <span class="am-stat">${escapeHtml(t.chipProcesses)}<b>${s.processes}</b></span>
        <span class="am-stat ${s.background ? 'am-stat-hot' : ''}">${escapeHtml(t.chipBackground)}<b>${s.background}</b></span>
        <span class="am-stat">${escapeHtml(t.chipAgents)}<b>${s.runningAgents}</b></span>
        ${s.workflows ? `<span class="am-stat">${escapeHtml(t.chipWorkflows)}<b>${s.workflows}</b></span>` : ''}
        <span class="am-stat">${escapeHtml(t.chipShells)}<b>${s.shells}</b></span>
        ${state.fetchedAt ? `<span class="am-updated">${escapeHtml(t.updated(duration(view.now - state.fetchedAt, t)))}</span>` : ''}
      </div>`);
  }

  if (state.notice) {
    top.push(`<div class="am-banner am-banner-${state.notice.type}" role="status">${escapeHtml(state.notice.text)}</div>`);
  }
  if (state.error) {
    top.push(`<div class="am-banner am-banner-error" role="alert">${escapeHtml(t.loadFailed(state.error))}</div>`);
  }

  const parts = [];
  if (!data) {
    if (!state.error) parts.push(`<div class="am-empty">${escapeHtml(t.loading)}</div>`);
  } else if (!data.supported) {
    parts.push(`<div class="am-empty"><strong>${escapeHtml(t.unsupported)}</strong></div>`);
  } else if (!data.processes.length) {
    parts.push(`<div class="am-empty"><strong>${escapeHtml(t.empty)}</strong>${escapeHtml(t.emptyHint)}</div>`);
  } else {
    for (const proc of data.processes) parts.push(processCard(view, proc, data.home));
  }

  const html = `<div class="am-top">${top.join('')}</div><div class="am-content">${parts.join('')}</div>`;
  if (html !== view.lastHtml) {
    view.body.innerHTML = html;
    view.lastHtml = html;
  }
}

// ---- data and actions ----------------------------------------------------------

async function refresh(view) {
  if (view.disposed) return;
  if (view.inflight) {
    view.refreshAgain = true;
    return view.inflight;
  }
  view.inflight = (async () => {
    try {
      const data = await view.api.rpc('GET', `/status?finished=${view.state.showFinished ? 1 : 0}`);
      if (data?.error) throw new Error(data.error);
      view.state.data = data;
      view.state.error = null;
      view.state.fetchedAt = Date.now();
    } catch (error) {
      view.state.error = error?.message || String(error);
    }
    render(view);
  })();
  try {
    await view.inflight;
  } finally {
    view.inflight = null;
  }
  if (view.refreshAgain) {
    view.refreshAgain = false;
    await refresh(view);
  }
}

function schedule(view) {
  clearTimeout(view.timer);
  if (view.disposed) return;
  view.timer = setTimeout(async () => {
    if (!document.hidden) await refresh(view);
    schedule(view);
  }, POLL_MS);
}

function showNotice(view, type, text) {
  clearTimeout(view.noticeTimer);
  view.state.notice = { type, text };
  view.noticeTimer = setTimeout(() => {
    view.state.notice = null;
    render(view);
  }, NOTICE_MS);
}

async function onStop(view, kind, pid) {
  const { state } = view;
  const key = `${kind}:${pid}`;
  if (state.stopping.has(key)) return;
  if (state.confirm?.key !== key) {
    state.confirm = { key };
    clearTimeout(view.confirmTimer);
    view.confirmTimer = setTimeout(() => {
      if (state.confirm?.key === key) {
        state.confirm = null;
        render(view);
      }
    }, CONFIRM_MS);
    render(view);
    return;
  }
  state.confirm = null;
  clearTimeout(view.confirmTimer);
  state.stopping.add(key);
  render(view);
  try {
    const result = await view.api.rpc('POST', '/stop', { kind, pid });
    if (result?.ok) showNotice(view, 'ok', result.signal === 'SIGKILL' ? view.t.killed(pid) : view.t.stopped(pid));
    else showNotice(view, 'error', view.t.stopFailed(result?.error || 'unknown error'));
  } catch (error) {
    showNotice(view, 'error', view.t.stopFailed(error?.message || String(error)));
  } finally {
    state.stopping.delete(key);
  }
  await refresh(view);
}

// ---- plugin entry points -------------------------------------------------------

const views = new WeakMap();

export function mount(container, api) {
  unmount(container);

  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('div');
  root.className = 'am-root';
  const body = document.createElement('div');
  root.appendChild(body);
  container.replaceChildren(style, root);

  let showFinished = false;
  try {
    showFinished = localStorage.getItem(FINISHED_KEY) === '1';
  } catch {
    // Storage unavailable; keep the default.
  }

  const view = {
    api,
    root,
    body,
    disposed: false,
    lastHtml: '',
    state: { data: null, error: null, fetchedAt: null, showFinished, confirm: null, stopping: new Set(), notice: null },
  };

  view.onClick = (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    if (target.dataset.action === 'refresh') {
      root.classList.add('am-refreshing');
      refresh(view).finally(() => root.classList.remove('am-refreshing'));
    }
    else if (target.dataset.action === 'stop') onStop(view, target.dataset.kind, Number(target.dataset.pid));
  };
  view.onChange = (event) => {
    if (event.target.dataset?.action !== 'toggle-finished') return;
    view.state.showFinished = event.target.checked;
    try {
      localStorage.setItem(FINISHED_KEY, view.state.showFinished ? '1' : '0');
    } catch {
      // Storage unavailable; the choice lasts for this view only.
    }
    refresh(view);
  };
  view.onVisibility = () => {
    if (!document.hidden) refresh(view);
  };
  root.addEventListener('click', view.onClick);
  root.addEventListener('change', view.onChange);
  document.addEventListener('visibilitychange', view.onVisibility);
  view.offContext = api.onContextChange?.(() => render(view));

  views.set(container, view);
  render(view);
  refresh(view);
  schedule(view);
}

export function unmount(container) {
  const view = views.get(container);
  if (!view) return;
  view.disposed = true;
  clearTimeout(view.timer);
  clearTimeout(view.noticeTimer);
  clearTimeout(view.confirmTimer);
  view.root.removeEventListener('click', view.onClick);
  view.root.removeEventListener('change', view.onChange);
  document.removeEventListener('visibilitychange', view.onVisibility);
  view.offContext?.();
  container.replaceChildren();
  views.delete(container);
}
