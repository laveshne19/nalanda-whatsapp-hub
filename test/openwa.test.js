'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignature, createClient } = require('../src/openwa');

const secret = 'a-long-enough-test-secret';
const sign = (body, s = secret) => 'sha256=' + crypto.createHmac('sha256', s).update(body).digest('hex');

test('valid signature passes', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, sign(body), secret), true);
});

test('wrong secret, tampered body, missing or malformed header all fail', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, sign(body, 'other-secret-xxxxxxxx'), secret), false);
  assert.equal(verifySignature(Buffer.from('{"a":2}'), sign(body), secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
  assert.equal(verifySignature(body, 'sha256=zz', secret), false);
  assert.equal(verifySignature(body, 'md5=abc', secret), false);
});

test('no secret configured fails closed', () => {
  const body = Buffer.from('x');
  assert.equal(verifySignature(body, sign(body, ''), ''), false);
  assert.equal(verifySignature(body, sign(body), undefined), false);
});

test('sendText posts to the right path with the key and returns the id', async () => {
  let call;
  const client = createClient({
    baseUrl: 'https://wa.example/', apiKey: 'k', sessionId: 'sess 1',
    fetchImpl: async (url, init) => { call = { url, init }; return { ok: true, json: async () => ({ messageId: 'M1' }) }; },
  });
  const out = await client.sendText('919999999999@c.us', 'hello');
  assert.equal(out.messageId, 'M1');
  assert.equal(call.url, 'https://wa.example/api/sessions/sess%201/messages/send-text');
  assert.equal(call.init.headers['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(call.init.body), { chatId: '919999999999@c.us', text: 'hello' });
});

test('sendText surfaces the status when OpenWA refuses (pacing limit)', async () => {
  const client = createClient({
    baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(() => client.sendText('1@c.us', 'x'), (e) => e.status === 429);
});

test('ensureWebhook creates the webhook when it is missing', async () => {
  const calls = [];
  const client = createClient({
    baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's1',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body });
      return init.method === 'POST' ? { ok: true, json: async () => ({}) } : { ok: true, json: async () => [{ url: 'http://other/hook' }] };
    },
  });
  const r = await client.ensureWebhook({ url: 'http://nalanda-hub:8080/webhook/openwa', secret: 'x'.repeat(20), events: ['message.received'] });
  assert.equal(r.created, true);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body).events, ['message.received']);
  assert.equal(JSON.parse(calls[1].body).url, 'http://nalanda-hub:8080/webhook/openwa');
});

test('ensureWebhook leaves an existing webhook alone', async () => {
  let posts = 0;
  const client = createClient({
    baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's1',
    fetchImpl: async (url, init = {}) => {
      if (init.method === 'POST') posts++;
      return { ok: true, json: async () => [{ url: 'http://nalanda-hub:8080/webhook/openwa' }] };
    },
  });
  const r = await client.ensureWebhook({ url: 'http://nalanda-hub:8080/webhook/openwa', secret: 'x'.repeat(20), events: ['message.received'] });
  assert.equal(r.created, false);
  assert.equal(posts, 0);
});

test('ensureWebhook reports failures instead of hiding them', async () => {
  const client = createClient({ baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's1', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(() => client.ensureWebhook({ url: 'u', secret: 'x'.repeat(20), events: ['message.received'] }), /401/);
});

test('ensureWebhook adds a missing event to a webhook that already exists', async () => {
  const calls = [];
  const client = createClient({
    baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's1',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body });
      return { ok: true, json: async () => [{ id: 'W1', url: 'http://nalanda-hub:8080/webhook/openwa', events: ['message.received'] }] };
    },
  });
  const r = await client.ensureWebhook({ url: 'http://nalanda-hub:8080/webhook/openwa', secret: 'x'.repeat(20), events: ['message.received', 'message.sent'] });
  assert.deepEqual(r, { created: false, updated: true });
  const put = calls.find((c) => c.method === 'PUT');
  assert.match(put.url, /\/webhooks\/W1$/);
  assert.deepEqual(JSON.parse(put.body).events, ['message.received', 'message.sent']);
});

test('ensureWebhook leaves a webhook alone when it already has every event, or "*"', async () => {
  for (const events of [['message.received', 'message.sent'], ['*']]) {
    let puts = 0;
    const client = createClient({
      baseUrl: 'https://wa.example', apiKey: 'k', sessionId: 's1',
      fetchImpl: async (url, init = {}) => { if (init.method === 'PUT') puts++; return { ok: true, json: async () => [{ id: 'W1', url: 'u', events }] }; },
    });
    assert.deepEqual(await client.ensureWebhook({ url: 'u', secret: 'x'.repeat(20), events: ['message.received', 'message.sent'] }), { created: false, updated: false });
    assert.equal(puts, 0);
  }
});
