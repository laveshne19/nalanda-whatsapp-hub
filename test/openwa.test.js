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
