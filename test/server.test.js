'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('../src/server');
const { State } = require('../src/state');
const { fromEnv } = require('../src/config');

const SECRET = 'webhook-secret-for-tests';

async function boot() {
  const sent = [];
  const config = {
    webhookSecret: SECRET, shopify: null, staffChat: null, businessHours: null, staffReplyPauses: false,
    limits: { repliesPerChatPerHour: 10, handoffHours: 12 },
  };
  const openwa = { sendText: async (c, t) => { sent.push({ c, t }); return { messageId: 'x' }; } };
  const server = createServer({ config, state: new State(null), openwa, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, sent, url: `http://127.0.0.1:${server.address().port}` };
}
const sign = (body, s = SECRET) => 'sha256=' + crypto.createHmac('sha256', s).update(body).digest('hex');
const event = JSON.stringify({ event: 'message.received', idempotencyKey: 'k1', data: { id: 'm', from: '919876543210@c.us', body: 'hi', type: 'chat' } });

test('signed webhook is accepted and answered', async () => {
  const { server, sent, url } = await boot();
  try {
    const res = await fetch(`${url}/webhook/openwa`, { method: 'POST', body: event, headers: { 'x-openwa-signature': sign(event) } });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1);
  } finally { server.close(); }
});

test('missing or wrong signature is rejected and nothing is sent', async () => {
  const { server, sent, url } = await boot();
  try {
    const a = await fetch(`${url}/webhook/openwa`, { method: 'POST', body: event });
    const b = await fetch(`${url}/webhook/openwa`, { method: 'POST', body: event, headers: { 'x-openwa-signature': sign(event, 'wrong-secret-wrong-secret') } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 0);
  } finally { server.close(); }
});

test('oversized body is refused', async () => {
  const { server, url } = await boot();
  try {
    const big = 'x'.repeat(300 * 1024);
    const res = await fetch(`${url}/webhook/openwa`, { method: 'POST', body: big, headers: { 'x-openwa-signature': sign(big) } }).catch(() => ({ status: 413 }));
    assert.equal(res.status, 413);
  } finally { server.close(); }
});

test('other paths and methods are 404, health is ok', async () => {
  const { server, url } = await boot();
  try {
    assert.equal((await fetch(`${url}/`)).status, 404);
    assert.equal((await fetch(`${url}/webhook/openwa`)).status, 404);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  } finally { server.close(); }
});

test('config refuses to start without a strong webhook secret', () => {
  const base = { OPENWA_URL: 'https://x', OPENWA_API_KEY: 'k', OPENWA_SESSION_ID: 's' };
  assert.throws(() => fromEnv({ ...base }), /WEBHOOK_SECRET/);
  assert.throws(() => fromEnv({ ...base, WEBHOOK_SECRET: 'short' }), /16 characters/);
  const ok = fromEnv({ ...base, WEBHOOK_SECRET: 'x'.repeat(20) });
  assert.equal(ok.shopify, null);
  assert.equal(ok.staffReplyPauses, false);
});
