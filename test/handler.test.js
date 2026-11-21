'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleEvent } = require('../src/handler');
const { State } = require('../src/state');

const CUSTOMER = '919876543210@c.us';

function setup(over = {}) {
  const sent = [];
  let n = 0;
  const openwa = { sendText: async (chatId, text) => { sent.push({ chatId, text }); return { messageId: `B${++n}` }; } };
  const config = {
    shopify: { domain: 's.example.com', token: 't', apiVersion: '2026-10' },
    staffChat: '919999900000@c.us',
    businessHours: '10am to 7pm',
    staffReplyPauses: false,
    limits: { repliesPerChatPerHour: 10, handoffHours: 12 },
    ...over.config,
  };
  const state = new State(null);
  const order = {
    name: '#1234', createdAt: 'x', cancelledAt: null, displayFulfillmentStatus: 'FULFILLED', phone: null,
    customer: { defaultPhoneNumber: { phoneNumber: '+91 98765 43210' } }, shippingAddress: null, billingAddress: null,
    fulfillments: [{ deliveredAt: null, trackingInfo: [{ company: 'Delhivery', number: 'DL1', url: null }] }],
  };
  const fetchImpl = over.fetchImpl || (async () => ({ ok: true, json: async () => ({ data: { orders: { edges: [{ node: order }] } } }) }));
  return { deps: { state, openwa, config, fetchImpl, log: () => {} }, sent, state };
}

let k = 0;
const msg = (body, extra = {}) => ({
  event: 'message.received', idempotencyKey: `id-${++k}`,
  data: { id: `m${k}`, from: CUSTOMER, body, type: 'chat', isGroup: false, ...extra },
});

test('greeting gets the menu', async () => {
  const { deps, sent } = setup();
  const r = await handleEvent(msg('hi'), deps);
  assert.equal(r.action, 'replied');
  assert.match(sent[0].text, /Track my order/);
  assert.equal(sent[0].chatId, CUSTOMER);
});

test('tracking with matching phone returns courier details', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('where is my order #1234'), deps);
  assert.match(sent[0].text, /Order #1234 has been shipped/);
  assert.match(sent[0].text, /Delhivery/);
});

test('tracking from a different phone reveals nothing and flags staff', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('track #1234', { from: '918000000000@c.us' }), deps);
  assert.match(sent[0].text, /privacy/);
  assert.ok(!/Delhivery|DL1/.test(sent[0].text));
  assert.match(sent[1].text, /Unverified tracking request for #1234/);
  assert.equal(sent[1].chatId, '919999900000@c.us');
});

test('tracking without an order number asks for it', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('track my order'), deps);
  assert.match(sent[0].text, /send your order number/);
});

test('unknown order number says so', async () => {
  const { deps, sent } = setup({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: { orders: { edges: [] } } }) }) });
  await handleEvent(msg('track #7777'), deps);
  assert.match(sent[0].text, /could not find order #7777/);
});

test('Shopify failure hands over to a person and pauses the bot', async () => {
  const { deps, sent, state } = setup({ fetchImpl: async () => { throw new Error('boom'); } });
  await handleEvent(msg('track #1234'), deps);
  assert.match(sent[0].text, /passed it to our team/);
  assert.equal(state.handoffActive(CUSTOMER), true);
  const r = await handleEvent(msg('hello?'), deps);
  assert.equal(r.action, 'human_handling');
});

test('bulk enquiry asks for details, then the next message goes to staff', async () => {
  const { deps, sent, state } = setup();
  await handleEvent(msg('need bulk order of power banks'), deps);
  assert.match(sent[0].text, /bulk or wholesale enquiry/);
  assert.match(sent[1].text, /^\[Bulk or wholesale enquiry\]/);
  await handleEvent(msg('500 pcs, ABC Traders Ludhiana, by 5 Dec'), deps);
  assert.match(sent[2].text, /we have noted this/);
  assert.match(sent[3].text, /Bulk enquiry details.*500 pcs/);
  assert.equal(state.handoffActive(CUSTOMER), true);
});

test('human request pauses the bot for the handoff window', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('I want a refund'), deps);
  assert.match(sent[0].text, /passed this to our team/);
  assert.match(sent[0].text, /10am to 7pm/);
  const r = await handleEvent(msg('anyone there'), deps);
  assert.equal(r.action, 'human_handling');
  assert.equal(sent.length, 2);
});

test('handoff expires after the window', async () => {
  const { deps, sent } = setup();
  const t0 = 1_000_000;
  await handleEvent(msg('I want a refund'), { ...deps, now: () => t0 });
  const later = t0 + 13 * 3600 * 1000;
  const r = await handleEvent(msg('hi'), { ...deps, now: () => later });
  assert.equal(r.action, 'replied');
  assert.ok(sent.length >= 3);
});

test('STOP opts out of broadcasts, START opts back in', async () => {
  const { deps, state, sent } = setup();
  await handleEvent(msg('STOP'), deps);
  assert.equal(state.isOptedOut(CUSTOMER), true);
  assert.match(sent[0].text, /unsubscribed/);
  await handleEvent(msg('START'), deps);
  assert.equal(state.isOptedOut(CUSTOMER), false);
});

test('opted-out customers still get order replies', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('STOP'), deps);
  await handleEvent(msg('track #1234'), deps);
  assert.match(sent[1].text, /Order #1234/);
});

test('duplicate deliveries are answered once', async () => {
  const { deps, sent } = setup();
  const p = msg('hi');
  await handleEvent(p, deps);
  const r = await handleEvent(p, deps);
  assert.equal(r.action, 'duplicate');
  assert.equal(sent.length, 1);
});

test('groups, status posts and own messages are ignored', async () => {
  const { deps, sent } = setup();
  for (const extra of [{ isGroup: true }, { isStatusBroadcast: true }, { fromMe: true }]) {
    assert.equal((await handleEvent(msg('hi', extra), deps)).action, 'ignored');
  }
  assert.equal(sent.length, 0);
});

test('images and voice notes go to a person', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('', { type: 'image' }), deps);
  assert.match(sent[0].text, /passed this to our team/);
  assert.match(sent[1].text, /^\[Media message\]/);
});

test('reply budget stops a runaway loop', async () => {
  const { deps, sent } = setup({ config: { limits: { repliesPerChatPerHour: 3, handoffHours: 12 } } });
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await handleEvent(msg('hi'), deps)).action);
  assert.deepEqual(results.slice(0, 3), ['replied', 'replied', 'replied']);
  assert.ok(results.slice(3).every((a) => a === 'rate_limited'));
  assert.equal(sent.length, 3);
});

test('an OpenWA pacing refusal does not crash the handler', async () => {
  const { deps } = setup();
  deps.openwa = { sendText: async () => { const e = new Error('429'); e.status = 429; throw e; } };
  const r = await handleEvent(msg('hi'), deps);
  assert.equal(r.action, 'send_failed');
});

test('staff replying from the phone pauses the bot only when that option is on', async () => {
  const off = setup();
  await handleEvent({ event: 'message.sent', data: { id: 'S1', to: CUSTOMER } }, off.deps);
  assert.equal(off.state.handoffActive(CUSTOMER), false);

  const on = setup({ config: { staffReplyPauses: true } });
  await handleEvent(msg('hi'), on.deps); // bot sends B1
  await handleEvent({ event: 'message.sent', data: { id: 'B1', to: CUSTOMER } }, on.deps); // the bot's own, ignored
  assert.equal(on.state.handoffActive(CUSTOMER), false);
  await handleEvent({ event: 'message.sent', data: { id: 'HUMAN', to: CUSTOMER } }, on.deps);
  assert.equal(on.state.handoffActive(CUSTOMER), true);
});

test('state survives a restart (file store)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-')), 'state.json');
  const a = new State(file);
  a.setOptOut(CUSTOMER, true);
  a.seen('abc');
  const b = new State(file);
  assert.equal(b.isOptedOut(CUSTOMER), true);
  assert.equal(b.seen('abc'), true);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
});

const unfulfilled = (phone) => ({
  name: '#2001', createdAt: 'x', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', phone: null,
  customer: { defaultPhoneNumber: { phoneNumber: phone } }, shippingAddress: null, billingAddress: null, fulfillments: [],
});
const ordersResponse = (node) => async () => ({ ok: true, json: async () => ({ data: { orders: { edges: node ? [{ node }] : [] } } }) });

test('"is my order confirmed" with a real order under the sender phone gets a confirmation with the dispatch day', async () => {
  const { deps, sent } = setup({ fetchImpl: ordersResponse(unfulfilled('+91 98765 43210')) });
  await handleEvent(msg('I placed an order, is it confirmed?'), deps);
  assert.match(sent[0].text, /order #2001 is confirmed/);
  assert.match(sent[0].text, /call you once to confirm/);
  assert.ok(!/[—–]/.test(sent[0].text));
});

test('"is my order confirmed" never claims confirmation when no order exists for that phone', async () => {
  const { deps, sent } = setup({ fetchImpl: ordersResponse(unfulfilled('+91 90000 00000')) });
  await handleEvent(msg('is my order confirmed?'), deps);
  assert.ok(!/confirmed/.test(sent[0].text));
  assert.match(sent[0].text, /order number/);
});
