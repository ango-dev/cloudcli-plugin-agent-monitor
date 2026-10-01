# Security policy

## Supported versions

Fixes go into the latest release only.

## Reporting a vulnerability

Please report vulnerabilities privately: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for them.

Describe what an attacker could do, how to reproduce it, and which versions of Agent Monitor, CloudCLI and Claude Code you used.

## Scope

Agent Monitor's backend reads Claude Code's local files and the process list, and it can signal Claude Code processes and their shells. Reports about these are especially welcome:

- making the backend signal anything other than a Claude Code process or one of its Bash shells
- making the backend read or reveal files outside `~/.claude`, or write anything
- making transcript content run as code in the tab, which escapes everything it shows

The backend listens on `127.0.0.1` without authentication of its own, as every CloudCLI plugin backend does. Hardening that is a matter for CloudCLI rather than this plugin.
