'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maybeSendShipments } = require('../src/shipments');
const { State } = require('../src/state');

const NOW = Date.parse('2026-11-21T18:30:00+05:30');
const node = (name, phone, createdAt = new Date(NOW - 3600e3).toISOString()) => ({
  name, cancelledAt: null, phone, customer: null, shippingAddress: null, billingAddress: null,
  fulfillments: [{ createdAt, trackingInfo: [{ company: 'Delhivery', number: 'DL' + name.slice(1), url: null }] }],
});

function setup(nodes, hourOk = true) {
  const sent = [];
  const deps = {
    state: new State(null), now: () => (hourOk ? NOW : Date.parse('2026-11-21T10:00:00+05:30')), sleep: async () => {}, log: () => {},
    config: { shopify: { domain: 's', token: 't', apiVersion: 'v' }, shipmentsHourIst: 18, staffChat: '919999900000@c.us' },
    openwa: { sendText: async (chatId, text) => { sent.push({ chatId, text }); return { messageId: 'M' + sent.length }; } },
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { orders: { edges: nodes.map((n) => ({ node: n })) } } }) }),
  };
  return { deps, sent };
}

test('sends tracking once per order at 6 PM, then tells the owner', async () => {
  const { deps, sent } = setup([node('#1001', '+91 98765 43210')]);
  assert.equal(await maybeSendShipments(deps), 1);
  assert.equal(sent[0].chatId, '919876543210@c.us');
  assert.match(sent[0].text, /order #1001 has been shipped/);
  assert.match(sent[0].text, /Tracking ID: DL1001/);
  assert.match(sent[1].text, /sent on WhatsApp to 1 customer/);
  assert.ok(!/[\u2014\u2013]/.test(sent[0].text));
  deps.state.setLastShipDate(null);
  deps._shipTry = null; deps.state._shipTry = null;
  assert.equal(await maybeSendShipments(deps), 0, 'same order is never sent twice');
});

test('does nothing before 6 PM', async () => {
  const { deps, sent } = setup([node('#1002', '9876543210')], false);
  assert.equal(await maybeSendShipments(deps), 0);
  assert.equal(sent.length, 0);
});

test('old shipments are ignored and orders without a phone are reported to the owner', async () => {
  const { deps, sent } = setup([node('#1003', '9876543210', new Date(NOW - 5 * 86400e3).toISOString()), node('#1004', null)]);
  assert.equal(await maybeSendShipments(deps), 0);
  assert.match(sent[0].text, /No phone number on: #1004/);
});
