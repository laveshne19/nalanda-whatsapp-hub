'use strict';
const http = require('node:http');
const { fromEnv } = require('./config');
const { State } = require('./state');
const { createClient, verifySignature } = require('./openwa');
const { handleEvent } = require('./handler');

const MAX_BODY = 256 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Build the request handler. Exported so tests can run it on a throwaway port. */
function createServer({ config, state, openwa, fetchImpl, log = console.log }) {
  const deps = { config, state, openwa, fetchImpl, log };

  return http.createServer(async (req, res) => {
    const send = (code, text) => {
      res.writeHead(code, { 'content-type': 'text/plain' });
      res.end(text);
    };

    if (req.method === 'GET' && req.url === '/healthz') return send(200, 'ok');
    if (req.method !== 'POST' || req.url !== '/webhook/openwa') return send(404, 'not found');

    let raw;
    try {
      raw = await readBody(req, MAX_BODY);
    } catch (e) {
      return send(e.status || 400, 'bad request');
    }

    // Signature first: nothing is parsed or acted on unless it is genuinely from OpenWA.
    if (!verifySignature(raw, req.headers['x-openwa-signature'], config.webhookSecret)) {
      return send(401, 'unauthorized');
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(400, 'bad json');
    }

    // Answer OpenWA straight away (it retries on slow replies); work continues in the background.
    send(200, 'ok');
    handleEvent(payload, deps).catch((e) => log(`[handler] error: ${e.message}`));
  });
}

if (require.main === module) {
  const config = fromEnv();
  const state = new State(config.statePath);
  const openwa = createClient(config.openwa);
  const server = createServer({ config, state, openwa });
  server.listen(config.port, '0.0.0.0', () => console.log(`[hub] listening on ${config.port}`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
