#!/usr/bin/env node
// Local stand-in for the archive signed-link endpoint, for emulator runs of the debug
// build (built with -Ptrails.signedUrlBase=http://10.0.2.2:<port>).
//
//   GET /app/signed-url?itemId=..&archiveKey=..  logs the request and returns a link to
//                                                /obj/<archiveKey>?itemId=<itemId>
//   GET /obj/readability                         a small archive page with a fixed marker text;
//                                                for an itemId that starts with "text-first",
//                                                a Markdown text with the marker TEXT-FIRST-FIXTURE
//   GET /obj/<a --stall key>                     holds the download open: the start of a page, then
//                                                one space every 5 s (under the app's 90 s read
//                                                timeout) for --stall-seconds, then the rest
//
// Usage: node signed-url-stub.mjs --port 8789 [--stall monolith]... [--stall-seconds 300]

import { createServer } from 'node:http';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8789);
if (!Number.isInteger(port) || port <= 0) {
  console.error('--port must be a positive integer');
  process.exit(1);
}

const stalled = new Set(
  process.argv.flatMap((arg, i) => (arg === '--stall' && process.argv[i + 1] ? [process.argv[i + 1]] : [])),
);
const stallIndex = process.argv.indexOf('--stall-seconds');
const stallSeconds = Number(stallIndex >= 0 ? process.argv[stallIndex + 1] : 300);
if (!Number.isInteger(stallSeconds) || stallSeconds <= 0) {
  console.error('--stall-seconds must be a positive integer');
  process.exit(1);
}
const TRICKLE_MS = 5000;

// Synthetic test text, not a real article.
const TEXT_FIRST_MARKDOWN =
  '# A text that arrives first\n\n' +
  'TEXT-FIRST-FIXTURE: this text is stored while a large archive of the same article is still downloading.\n';

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
    const link = `http://10.0.2.2:${port}/obj/${encodeURIComponent(archiveKey)}?itemId=${encodeURIComponent(itemId)}`;
    res.end(JSON.stringify({ url: link }));
    return;
  }

  const objKey = req.method === 'GET' && url.pathname.startsWith('/obj/')
    ? decodeURIComponent(url.pathname.slice('/obj/'.length))
    : null;
  const objItemId = url.searchParams.get('itemId') ?? '';

  if (objKey !== null && stalled.has(objKey)) {
    console.log(`object ${objKey} stalling itemId=${objItemId} for ${stallSeconds}s`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html>');
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started < stallSeconds * 1000) {
        res.write(' ');
        return;
      }
      clearInterval(timer);
      res.end('<html><body><p>Stalled archive</p></body></html>');
      console.log(`object ${objKey} ended itemId=${objItemId}`);
    }, TRICKLE_MS);
    res.on('close', () => {
      if (!res.writableEnded) console.log(`object ${objKey} closed by the client itemId=${objItemId}`);
      clearInterval(timer);
    });
    return;
  }

  if (objKey === 'readability') {
    console.log(`object readability itemId=${objItemId}`);
    if (objItemId.startsWith('text-first')) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(TEXT_FIRST_MARKDOWN);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ARCHIVE_HTML);
    return;
  }

  console.log(`404 ${req.method} ${url.pathname}`);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`signed-url stub listening on ${port}`));
