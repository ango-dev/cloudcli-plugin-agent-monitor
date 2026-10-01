// Agent Monitor backend. cloudcli starts this process and proxies the tab's RPC calls to it.

import http from 'node:http';

import { createCollector } from './collect.js';
import { stopTarget } from './kill.js';

const MAX_BODY_BYTES = 64 * 1024;

const collector = createCollector();

// Snapshots share caches, so they run one at a time.
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      const includeFinished = url.searchParams.get('finished') === '1';
      try {
        send(res, 200, await serialized(() => collector.snapshot({ includeFinished })));
      } catch (error) {
        // cloudcli's RPC proxy drops error bodies, so failures travel as data.
        send(res, 200, { error: error?.message || String(error) });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      const body = await readBody(req);
      const result = await stopTarget({ kind: body.kind, pid: Number(body.pid) });
      send(res, 200, result);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 500, { error: error?.message || String(error) });
  }
});

// cloudcli stops reading stdout after the ready line; never crash on a closed pipe.
process.stdout.on('error', () => {});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    // cloudcli waits for this line to learn the port.
    process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
  }
});

// Exit with cloudcli: once the parent is gone the process is re-parented.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid) process.exit(0);
}, 5000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
