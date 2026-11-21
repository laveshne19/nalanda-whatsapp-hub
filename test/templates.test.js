'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { T, orderStatus, staffNote } = require('../src/templates');

const sample = [
  T.menu(), T.askOrderNumber(), T.notFound('1234'), T.unverified(), T.lookupFailed(), T.order(),
  T.bulkAsk(), T.bulkThanks(), T.human('10am to 7pm'), T.unknown(), T.optOut(), T.optIn(),
  orderStatus({ name: '#1234', fulfillmentStatus: 'FULFILLED', fulfillments: [] }),
];

test('no customer message contains an em dash or en dash', () => {
  for (const s of sample) assert.ok(!/[—–]/.test(s), `dash found in: ${s}`);
});

test('every message fits comfortably in one WhatsApp text', () => {
  for (const s of sample) assert.ok(s.length < 900);
});

test('shipped order shows courier, tracking number and link', () => {
  const text = orderStatus({
    name: '#1234',
    fulfillmentStatus: 'FULFILLED',
    fulfillments: [{ trackingInfo: [{ company: 'Delhivery', number: 'DL123', url: 'https://t.example/DL123' }] }],
  });
  assert.match(text, /Order #1234 has been shipped/);
  assert.match(text, /Courier: Delhivery, Tracking number: DL123/);
  assert.match(text, /https:\/\/t\.example\/DL123/);
});

test('cancelled order is reported as cancelled', () => {
  assert.match(orderStatus({ name: '#9', cancelledAt: '2026-11-01T00:00:00Z', fulfillmentStatus: 'UNFULFILLED' }), /cancelled/);
});

test('delivered orders say when', () => {
  const text = orderStatus({
    name: '#1', fulfillmentStatus: 'FULFILLED',
    fulfillments: [{ deliveredAt: '2026-11-10T08:00:00Z', trackingInfo: [] }],
  });
  assert.match(text, /delivered on 10 Nov 2026/);
});

test('staff note is trimmed and single line', () => {
  const note = staffNote('Bulk enquiry', '+919999999999', 'a\nb  c '.repeat(200));
  assert.ok(note.length < 400);
  assert.ok(!note.includes('\n'));
});
