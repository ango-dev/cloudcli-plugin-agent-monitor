// A terminal that runs one Claude Code session, so that session is not filed under CloudCLI.
import { spawn } from 'node:child_process';
spawn(process.execPath, ['/demo/fake-claude.mjs'], { argv0: 'claude', env: process.env, stdio: 'ignore' });
setInterval(() => {}, 60_000);
