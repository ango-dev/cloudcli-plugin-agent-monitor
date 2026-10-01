// Serves the Agent Monitor tab outside cloudcli, for development and screenshots.
//
//   node dev/preview.mjs                live data from this machine (Stop really stops)
//   node dev/preview.mjs --mock         sample data from dev/mock-status.mjs
//   node dev/preview.mjs --port 5000    another port (default 4173)
//
// Then open http://127.0.0.1:4173/ and add ?theme=dark or ?lang=ko as needed.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCollector } from '../server/collect.js';
import { stopTarget } from '../server/kill.js';
import { mockStatus } from './mock-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mock = args.includes('--mock');
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4173;
const collector = mock ? null : createCollector();

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Monitor preview</title>
<style>
  html, body { margin: 0; height: 100%; background: #ffffff; }
  body.dark { background: #0b1120; }
  #host { height: 100vh; }
</style>
</head>
<body>
<div id="host"></div>
<script type="module">
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', theme === 'dark');
  if (params.get('lang')) localStorage.setItem('user-preferences', JSON.stringify({ userLanguage: params.get('lang') }));
  if (params.get('finished')) localStorage.setItem('agent-monitor:show-finished', params.get('finished'));
  const plugin = await import('/ui/index.js');
  plugin.mount(document.getElementById('host'), {
    context: { theme, project: null, session: null },
    onContextChange: () => () => {},
    async rpc(method, rpcPath, body) {
      const res = await fetch('/rpc/' + rpcPath.replace(/^\\//, ''), {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error('RPC error ' + res.status);
      return res.json();
    },
  });
</script>
</body>
</html>`;

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE);
    if (url.pathname === '/ui/index.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(root, 'ui', 'index.js')));
    }
    if (url.pathname === '/rpc/status') {
      const includeFinished = url.searchParams.get('finished') === '1';
      const data = mock ? mockStatus(Date.now(), includeFinished) : await collector.snapshot({ includeFinished });
      return send(res, 200, 'application/json', JSON.stringify(data));
    }
    if (url.pathname === '/rpc/stop' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const result = mock
        ? { ok: true, kind: body.kind, pid: body.pid, signal: 'SIGTERM', exited: true }
        : await stopTarget({ kind: body.kind, pid: Number(body.pid) });
      return send(res, 200, 'application/json', JSON.stringify(result));
    }
    send(res, 404, 'application/json', JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    send(res, 500, 'application/json', JSON.stringify({ error: error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Agent Monitor preview (${mock ? 'sample data' : 'live data'}): http://127.0.0.1:${port}/`);
});
