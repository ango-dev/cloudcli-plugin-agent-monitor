# Demo environment

A Docker image with CloudCLI and three staged Claude Code sessions. Use it to try Agent Monitor inside a real CloudCLI on Linux, or to retake the screenshots in the main README. Nothing in it talks to Anthropic: the Claude Code processes are stand-ins that write transcripts in Claude Code's format.

## Run it

From the repository root:

```bash
docker build -t agent-monitor-demo dev/demo
docker run --rm --init -p 127.0.0.1:3101:3001 -v "$PWD":/plugin-src:ro agent-monitor-demo
```

Open http://127.0.0.1:3101, create an account and open the shop-api session; the **Agent Monitor** tab is in the tab bar. The container copies the plugin from your checkout when it starts, so restart it to pick up changes. `--init` gives the container an init process that collects exited processes, as on a normal system.

With Colima on macOS, keep the checkout under your home folder: Colima shares only that folder with its virtual machine.

## What it stages

| Session | What you see |
| --- | --- |
| shop-api, "Refactor payment webhooks" | The turn ends after about 20 seconds while two background agents, one nested in the other, and a dev server keep running. The chat marks both agents as done. |
| docs-site, "Write release notes for v2.4" | A turn in progress, with a foreground agent fetching pages. |
| mobile-app, "Fix flaky login test" | A terminal session waiting for input. |

- `cloudcli-demo.mjs` starts the sessions and writes their transcripts as time passes. Its file name contains "cloudcli", which is how Agent Monitor files the sessions it starts under CloudCLI.
- `fake-claude.mjs` stands in for a Claude Code process. It registers its session in `~/.claude/sessions` and runs Bash tool shells shaped like Claude Code's, with a shell function in place of the real command.
- `terminal.mjs` plays a terminal, so its session counts as a terminal session.

The screenshots in `docs/` show this demo about a minute after it starts, in a 1440x900 browser window.
