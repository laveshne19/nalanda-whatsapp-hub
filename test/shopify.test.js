'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupOrder, phoneKey } = require('../src/shopify');

const shopify = { domain: 'shop.example.com', token: 'tok', apiVersion: '2026-10' };

const node = (over = {}) => ({
  name: '#1234', createdAt: '2026-11-01T00:00:00Z', cancelledAt: null,
  displayFulfillmentStatus: 'FULFILLED', displayFinancialStatus: 'PAID',
  phone: null,
  customer: { defaultPhoneNumber: { phoneNumber: '+91 98765 43210' } },
  shippingAddress: { phone: null }, billingAddress: { phone: null },
  fulfillments: [{ status: 'SUCCESS', deliveredAt: null, trackingInfo: [{ company: 'X', number: 'N1', url: null }] }],
  ...over,
});
const respond = (edges) => async () => ({ ok: true, json: async () => ({ data: { orders: { edges } } }) });

test('phone keys compare on the last 10 digits', () => {
  assert.equal(phoneKey('+91 98765-43210'), '9876543210');
  assert.equal(phoneKey('09876543210'), '9876543210');
  assert.equal(phoneKey('12345'), '');
});

test('matching phone returns order details', async () => {
  const r = await lookupOrder({ shopify, orderNumber: '1234', senderPhone: '919876543210', fetchImpl: respond([{ node: node() }]) });
  assert.equal(r.verified, true);
  assert.equal(r.order.name, '#1234');
  assert.equal(r.order.fulfillmentStatus, 'FULFILLED');
});

test('different phone gets NO details, only "found but unverified"', async () => {
  const r = await lookupOrder({ shopify, orderNumber: '1234', senderPhone: '919000000000', fetchImpl: respond([{ node: node() }]) });
  assert.deepEqual(r, { found: true, verified: false });
});

test('no sender phone known means unverified', async () => {
  const r = await lookupOrder({ shopify, orderNumber: '1234', senderPhone: '', fetchImpl: respond([{ node: node() }]) });
  assert.equal(r.verified, false);
});

test('any phone on the order may match (shipping address phone)', async () => {
  const n = node({ customer: null, shippingAddress: { phone: '+91 90000 00000' } });
  const r = await lookupOrder({ shopify, orderNumber: '1234', senderPhone: '919000000000', fetchImpl: respond([{ node: n }]) });
  assert.equal(r.verified, true);
});

test('unknown order number', async () => {
  const r = await lookupOrder({ shopify, orderNumber: '9999', senderPhone: '919876543210', fetchImpl: respond([]) });
  assert.deepEqual(r, { found: false });
});

test('non numeric order numbers never reach Shopify (no query injection)', async () => {
  let called = false;
  const r = await lookupOrder({ shopify, orderNumber: '1234 OR name:*', senderPhone: '1', fetchImpl: async () => { called = true; } });
  assert.deepEqual(r, { found: false });
  assert.equal(called, false);
});

test('sends token header and the validated query', async () => {
  let seen;
  await lookupOrder({
    shopify, orderNumber: '1234', senderPhone: '919876543210',
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ data: { orders: { edges: [] } } }) }; },
  });
  assert.equal(seen.url, 'https://shop.example.com/admin/api/2026-10/graphql.json');
  assert.equal(seen.init.headers['x-shopify-access-token'], 'tok');
  assert.match(JSON.parse(seen.init.body).query, /defaultPhoneNumber/);
  assert.equal(JSON.parse(seen.init.body).variables.q, 'name:#1234');
});

test('HTTP and GraphQL errors throw', async () => {
  await assert.rejects(() => lookupOrder({ shopify, orderNumber: '1234', senderPhone: '1', fetchImpl: async () => ({ ok: false, status: 500 }) }));
  await assert.rejects(() => lookupOrder({ shopify, orderNumber: '1234', senderPhone: '1', fetchImpl: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'x' }] }) }) }));
});

// ---- client credentials (Dev Dashboard apps): client id + secret, 24 hour tokens ----
const { createTokenProvider } = require('../src/shopify');

function tokenServer(over = {}) {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (over.fail) return { ok: false, status: over.fail };
    return { ok: true, json: async () => ({ access_token: `tok${++n}`, scope: over.scope ?? 'read_orders', expires_in: over.expires ?? 86399 }) };
  };
  return { calls, fetchImpl };
}

test('token request is the exact one Shopify documents', async () => {
  const { calls, fetchImpl } = tokenServer();
  const p = createTokenProvider({ domain: 'shop.myshopify.com', clientId: 'cid', clientSecret: 'sec', fetchImpl });
  assert.equal(await p.getToken(), 'tok1');
  assert.equal(calls[0].url, 'https://shop.myshopify.com/admin/oauth/access_token');
  assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'cid');
  assert.equal(body.get('client_secret'), 'sec');
  assert.equal(p.scope(), 'read_orders');
});

test('token is reused until five minutes before it expires, then renewed', async () => {
  const { calls, fetchImpl } = tokenServer({ expires: 3600 });
  let clock = 1_000_000;
  const p = createTokenProvider({ domain: 'd', clientId: 'a', clientSecret: 'b', fetchImpl, now: () => clock });
  assert.equal(await p.getToken(), 'tok1');
  clock += 54 * 60 * 1000;
  assert.equal(await p.getToken(), 'tok1');
  assert.equal(calls.length, 1);
  clock += 2 * 60 * 1000; // 56 minutes, inside the 5 minute safety margin
  assert.equal(await p.getToken(), 'tok2');
  assert.equal(calls.length, 2);
});

test('many simultaneous requests share one token request', async () => {
  const { calls, fetchImpl } = tokenServer();
  const p = createTokenProvider({ domain: 'd', clientId: 'a', clientSecret: 'b', fetchImpl });
  const tokens = await Promise.all([p.getToken(), p.getToken(), p.getToken(), p.getToken()]);
  assert.deepEqual(new Set(tokens), new Set(['tok1']));
  assert.equal(calls.length, 1);
});

test('wrong credentials surface as an error, and the next call tries again', async () => {
  const bad = tokenServer({ fail: 400 });
  const p = createTokenProvider({ domain: 'd', clientId: 'a', clientSecret: 'b', fetchImpl: bad.fetchImpl });
  await assert.rejects(() => p.getToken(), /HTTP 400/);
  await assert.rejects(() => p.getToken(), /HTTP 400/);
  assert.equal(bad.calls.length, 2);
});

test('a fixed token is used as it is, with no token request', async () => {
  const { calls, fetchImpl } = tokenServer();
  const p = createTokenProvider({ domain: 'd', staticToken: 'fixed', fetchImpl });
  assert.equal(await p.getToken(), 'fixed');
  assert.equal(calls.length, 0);
});

test('order lookup gets a token first, and sends it', async () => {
  const seen = [];
  const auth = createTokenProvider({
    domain: 'shop.example.com', clientId: 'a', clientSecret: 'b',
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: 'T1', scope: 'read_orders', expires_in: 86399 }) }),
  });
  await lookupOrder({
    shopify: { domain: 'shop.example.com', apiVersion: '2026-10', auth }, orderNumber: '1234', senderPhone: '919876543210',
    fetchImpl: async (url, init) => { seen.push(init.headers['x-shopify-access-token']); return { ok: true, json: async () => ({ data: { orders: { edges: [] } } }) }; },
  });
  assert.deepEqual(seen, ['T1']);
});

test('a 401 from Shopify renews the token and retries once', async () => {
  let issued = 0;
  const auth = createTokenProvider({
    domain: 'd', clientId: 'a', clientSecret: 'b',
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: `T${++issued}`, scope: 'read_orders', expires_in: 86399 }) }),
  });
  const used = [];
  const r = await lookupOrder({
    shopify: { domain: 'd', apiVersion: '2026-10', auth }, orderNumber: '1234', senderPhone: '919876543210',
    fetchImpl: async (url, init) => {
      used.push(init.headers['x-shopify-access-token']);
      return used.length === 1 ? { ok: false, status: 401 } : { ok: true, json: async () => ({ data: { orders: { edges: [] } } }) };
    },
  });
  assert.deepEqual(used, ['T1', 'T2']);
  assert.deepEqual(r, { found: false });
});

test('a second 401 gives up instead of looping', async () => {
  const auth = createTokenProvider({
    domain: 'd', clientId: 'a', clientSecret: 'b',
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: 'T', scope: 'read_orders', expires_in: 86399 }) }),
  });
  let calls = 0;
  await assert.rejects(() => lookupOrder({
    shopify: { domain: 'd', apiVersion: '2026-10', auth }, orderNumber: '1234', senderPhone: '919876543210',
    fetchImpl: async () => { calls++; return { ok: false, status: 401 }; },
  }), /HTTP 401/);
  assert.equal(calls, 2);
});
