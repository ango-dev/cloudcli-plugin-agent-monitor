# Contributing to Agent Monitor

Thanks for taking the time. Bug reports, ideas and pull requests are all welcome.

## Reporting problems

Most bugs here come from a Claude Code or CloudCLI release changing something the plugin reads. When you [open a bug report](https://github.com/notetook/cloudcli-plugin-agent-monitor/issues/new?template=bug_report.yml), please include:

- your Agent Monitor, CloudCLI, Claude Code and Node.js versions and your operating system
- what the tab showed, and what was actually running
- for a wrong agent or turn state, the last few lines of the transcript involved: `~/.claude/projects/<project>/<session>.jsonl` for a session, `<session>/subagents/agent-<id>.jsonl` for an agent

Transcripts contain your prompts, file paths and tool output. Read them and remove anything private before you paste them.

For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

You need Node.js 22 or newer on macOS or Linux. There are no dependencies to install and no build step.

```bash
git clone https://github.com/notetook/cloudcli-plugin-agent-monitor.git
cd cloudcli-plugin-agent-monitor
npm test
```

To work on the tab without CloudCLI, run the preview server:

```bash
npm run preview        # live data from your machine at http://127.0.0.1:4173/
npm run preview:mock   # sample data from dev/mock-status.mjs
```

Add `?theme=dark`, `?lang=ko` or `?finished=1` to the URL. In live mode the Stop buttons really stop processes.

To try your changes in a real CloudCLI without touching your own, run the Docker demo in [dev/demo](dev/demo/README.md). It also runs the plugin on Linux, which is worth checking if you develop on a Mac.

To try them in your own CloudCLI, clone the repository into `~/.claude-code-ui/plugins/` (CloudCLI skips symlinked folders there). After changing `ui/index.js`, reload the page. After changing anything in `server/`, disable and enable the plugin in **Settings > Plugins** so that CloudCLI restarts its backend.

## Guidelines

- **No dependencies.** CloudCLI installs plugins with `npm install --ignore-scripts`. A plugin that needs nothing installs fast and is easy to review.
- **No build step.** The backend is plain ES modules. The tab must stay a single module without imports, because CloudCLI loads it from a blob URL.
- **Read, never write.** The backend must not change anything under `~/.claude`. Its only side effect is the signal sent by Stop, and only after checking the target against a fresh process list.
- **Test what you change.** State detection lives in `server/transcripts.js` and `server/collect.js`. Add a test case for each transcript shape you handle. `test/kill.test.js` starts real processes, so keep it quick and make sure it cleans up after itself.
- **Escape everything the tab shows.** Titles, prompts, descriptions and commands come from transcripts. Pass them through `escapeHtml()`.
- **Check both themes and both languages** in the preview when you change the tab, and add every new string to each block in `STRINGS` in `ui/index.js`.
- **Keep the README in sync** with what the tab shows and does.

### Adding a language

Add a block to `STRINGS` in `ui/index.js`, keyed by the language code CloudCLI uses (for example `de` or `zh-CN`), with every key the `en` block has, including `units`. The tab picks it up from CloudCLI's language setting by itself.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Run `npm test`.
4. Describe what you changed and how you checked it. For changes to the tab, a screenshot helps.

The screenshots in `docs/` show the Docker demo about a minute after it starts, in a 1440x900 browser window at twice the pixel density, scaled to 2000 pixels wide.

## Releases

Versions follow [semantic versioning](https://semver.org/). `manifest.json` and `package.json` carry the same version, and [CHANGELOG.md](CHANGELOG.md) lists what changed in each release.
