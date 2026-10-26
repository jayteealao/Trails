#!/usr/bin/env node
// Local stand-in for the archive signed-link endpoint, for emulator runs of the debug
// build (built with -Ptrails.signedUrlBase=http://10.0.2.2:<port>).
//
//   GET /app/signed-url?itemId=..&archiveKey=..  logs the request and returns a link to /obj/<archiveKey>
//   GET /obj/readability                         a small archive page with a fixed marker text
//
// Usage: node signed-url-stub.mjs --port 8789

import { createServer } from 'node:http';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8789);
if (!Number.isInteger(port) || port <= 0) {
  console.error('--port must be a positive integer');
  process.exit(1);
}

const ARCHIVE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Canonical fixture</title></head>' +
  '<body><h1>Canonical fixture</h1><p>CANONICAL-FIXTURE-ARCHIVE</p></body></html>';

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/app/signed-url') {
    const itemId = url.searchParams.get('itemId') ?? '';
    const archiveKey = url.searchParams.get('archiveKey') ?? '';
    console.log(`signed-url itemId=${itemId} archiveKey=${archiveKey}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: `http://10.0.2.2:${port}/obj/${encodeURIComponent(archiveKey)}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/obj/readability') {
    console.log('object readability');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ARCHIVE_HTML);
    return;
  }

  console.log(`404 ${req.method} ${url.pathname}`);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '0.0.0.0', () => console.log(`signed-url stub listening on ${port}`));
