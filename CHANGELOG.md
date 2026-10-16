# Changelog

Notable changes to Agent Monitor. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Workflows started with the Workflow tool, under each process: the run's name, how many of its agents have finished, and its running agents with their label, phase and current tool call. A session whose turn has ended while a workflow runs is now *Background* instead of *Idle*, workflow agents count in *Agents running*, and their shells show as their tool calls.

### Fixed

- A finished agent nested under a running one no longer pulses as if it were running.

### Changed

- The tab takes its colours, fonts (Geist and Geist Mono) and corner radius from the CloudCLI host's theme variables, with built-in fallbacks for hosts that lack them. Status colours were retuned to sit on those backgrounds in both themes.
- The tab is called **Agents** in CloudCLI's tab bar and in its own header.
- The header is laid out like CloudCLI's built-in Browser tab: a bar with the tab's icon, title and subtitle, an icon-only refresh button, and a strip below it with the counts and the last update. It stays in place while the list scrolls, and notices appear under it as full-width bars.
- Fallback colours match the host theme's exact values, including its new dark border colour, and badges, buttons and dividers follow the host's shapes.

## [0.1.0] - 2026-10-01

First release.

### Added

- A CloudCLI tab listing running Claude Code processes with session title, project, PID, uptime, CPU and memory, and a Working, Background or Idle status.
- The subagents of each process, nested under the agent that started them, with their current tool call, start time and last activity. Finished agents on request.
- The Bash tool shells of each process, marked as background work or as a pending tool call.
- Stop for a process or a single shell, with a confirmation click, a SIGKILL fallback and cleanup of leftover shells.
- Light and dark theme, English and Korean.

[0.1.0]: https://github.com/notetook/cloudcli-plugin-agent-monitor/releases/tag/v0.1.0
