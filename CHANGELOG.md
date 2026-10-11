# Changelog

Notable changes to Agent Monitor. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org/).

## [Unreleased]

### Changed

- The tab takes its colours, fonts (Geist and Geist Mono) and corner radius from the CloudCLI host's theme variables, with built-in fallbacks for hosts that lack them. Status colours were retuned to sit on those backgrounds in both themes.

## [0.1.0] - 2026-10-01

First release.

### Added

- A CloudCLI tab listing running Claude Code processes with session title, project, PID, uptime, CPU and memory, and a Working, Background or Idle status.
- The subagents of each process, nested under the agent that started them, with their current tool call, start time and last activity. Finished agents on request.
- The Bash tool shells of each process, marked as background work or as a pending tool call.
- Stop for a process or a single shell, with a confirmation click, a SIGKILL fallback and cleanup of leftover shells.
- Light and dark theme, English and Korean.

[0.1.0]: https://github.com/notetook/cloudcli-plugin-agent-monitor/releases/tag/v0.1.0
