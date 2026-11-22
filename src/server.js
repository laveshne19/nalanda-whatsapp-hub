'use strict';
const http = require('node:http');
const { fromEnv } = require('./config');
const { State } = require('./state');
const { createClient, verifySignature } = require('./openwa');
const { handleEvent, intakeLead } = require('./handler');
const { maybeSendDailyReport, sweepLeads, followUpLeads } = require('./report');
const { maybeSendShipments } = require('./shipments');
const { retry } = require('./util');

const MAX_BODY = 256 * 1024;
const MAX_LEAD_BODY = 32 * 1024;

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

    // Website enquiry form (server to server, e.g. a Netlify function). Off unless LEADS_SECRET is set.
    if (req.method === 'POST' && req.url === '/lead/website') {
      if (!config.leads || !config.leads.secret) return send(404, 'not found');
      let raw;
      try {
        raw = await readBody(req, MAX_LEAD_BODY);
      } catch (e) {
        return send(e.status || 400, 'bad request');
      }
      if (!verifySignature(raw, req.headers['x-lead-signature'], config.leads.secret)) return send(401, 'unauthorized');
      let input;
      try {
        input = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(400, 'bad json');
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, 'bad json');
      try {
        const out = await intakeLead(input, deps);
        res.writeHead(out.ok ? 200 : out.status || 400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out.ok ? { ok: true, ref: out.ref } : { ok: false, error: out.error }));
      } catch (e) {
        log(`[lead] error: ${e.message}`);
        return send(500, 'error');
      }
    }

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
  const log = console.log;
  const server = createServer({ config, state, openwa });
  server.listen(config.port, '0.0.0.0', () => log(`[hub] listening on ${config.port}`));

  // Check the Shopify credentials now, so a typo shows up in the logs at start, not on a customer's order.
  if (config.shopify && config.shopify.auth) {
    config.shopify.auth
      .getToken()
      .then(() => {
        const scope = config.shopify.auth.scope();
        log(`[hub] Shopify connected${scope ? `, access: ${scope}` : ''}`);
        if (scope && /write_/.test(scope)) log('[hub] WARNING: the Shopify app can WRITE. This hub only needs read_orders, remove the extra access.');
      })
      .catch((e) => log(`[hub] Shopify login failed: ${e.message}. Order tracking will hand over to a person.`));
  }

  // Tell OpenWA where to send messages. Failure is logged, never fatal (it can be set in the dashboard instead).
  if (config.hubWebhookUrl) {
    const events = config.staffReplyPauses ? ['message.received', 'message.sent'] : ['message.received'];
    retry(() => openwa.ensureWebhook({ url: config.hubWebhookUrl, secret: config.webhookSecret, events }), {
      tries: 20,
      delayMs: 15000,
      onRetry: (n, e) => log(`[hub] OpenWA not ready yet (${e.message}), trying again (${n}/19)`),
    })
      .then((r) => log(`[hub] webhook ${r.created ? 'registered' : 'already present'} in OpenWA`))
      .catch((e) => log(`[hub] could not register webhook automatically: ${e.message}`));
  }

  // Once a minute: send the daily report when due, and make sure unanswered leads reach a person.
  const deps = { config, state, openwa, log };
  const tick = () => {
    maybeSendDailyReport(deps).catch((e) => log(`[report] ${e.message}`));
    sweepLeads(deps).catch((e) => log(`[sweep] ${e.message}`));
    followUpLeads(deps).catch((e) => log(`[followup] ${e.message}`));
    maybeSendShipments(deps).catch((e) => log(`[shipments] ${e.message}`));
  };
  setInterval(tick, 60 * 1000).unref();

  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
