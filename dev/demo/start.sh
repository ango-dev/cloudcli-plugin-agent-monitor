#!/bin/sh
# Runs in the demo container: installs the mounted plugin, stages the sessions, starts CloudCLI.
set -e
mkdir -p ~/code/shop-api/src/webhooks ~/code/docs-site ~/code/mobile-app ~/.claude/shell-snapshots ~/.claude-code-ui/plugins
rm -rf ~/.claude-code-ui/plugins/cloudcli-plugin-agent-monitor
cp -R /plugin-src ~/.claude-code-ui/plugins/cloudcli-plugin-agent-monitor
node /demo/cloudcli-demo.mjs > /tmp/demo.log 2>&1 &
exec cloudcli
