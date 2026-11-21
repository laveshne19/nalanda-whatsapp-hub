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
