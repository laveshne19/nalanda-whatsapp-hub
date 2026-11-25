'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanPayments, maybeSendPaymentSummary, parsePayment, findPayments } = require('../src/paymentlog');
const { State } = require('../src/state');

test('reads the amount and mode from a payment screenshot', () => {
  assert.deepEqual(parsePayment('Payment Successful NALANDA ENTERPRISES ₹6,000 UPI transaction ID 123'), { amount: 6000, mode: 'UPI' });
  assert.deepEqual(parsePayment('NALANDA ENTERPRISES 26,690 Request Accepted NEFT payment'), { amount: 26690, mode: 'NEFT' });
  assert.deepEqual(parsePayment('Transaction Successful Rs. 17,859.00 IMPS'), { amount: 17859, mode: 'IMPS' });
  assert.equal(parsePayment('no money here').amount, 0);
});

function setup(over = {}) {
  const sent = [];
  const t = Date.parse('2026-11-24T20:30:00+05:30');
  const hist = [
    { id: 'A', type: 'image', timestamp: Math.floor(Date.parse('2026-11-24T15:10:00+05:30') / 1000), body: 'Happy kharar' },
    { id: 'B', type: 'image', timestamp: Math.floor(Date.parse('2026-11-24T15:20:00+05:30') / 1000), body: 'Vikrant against bill', fromMe: true },
    { id: 'C', type: 'text', timestamp: Math.floor(Date.parse('2026-11-24T15:30:00+05:30') / 1000), body: 'hello' },
  ];
  const deps = {
    state: new State(null), now: () => t, sleep: async () => {}, log: () => {},
    config: { staffChat: '919999900000@c.us', payments: { groupId: 'G@g.us', everyMinutes: 30, maxPerRun: 10, pauseMs: 0, summaryHour: 20 } },
    openwa: { sendText: async (chat, text) => { sent.push({ chat, text }); return { messageId: 'T' }; } },
    payClient: { history: async () => hist, media: async () => Buffer.from('img') },
    ocr: async () => 'Payment Successful ₹6,000 NALANDA UPI',
    ...over,
  };
  return { deps, sent };
}

test('logs a customer payment picture once and skips our own sends', async () => {
  const { deps } = setup();
  assert.equal(await scanPayments(deps), 1);
  const items = deps.state.data.payLog.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].party, 'Happy kharar');
  assert.equal(items[0].amount, 6000);
  assert.equal(items[0].date, '2026-11-24');
  deps.now = () => Date.parse('2026-11-24T21:30:00+05:30');
  assert.equal(await scanPayments(deps), 0);
  assert.equal(deps.state.data.payLog.items.length, 1);
  assert.equal(findPayments(deps.state, 6000, '2026-11-24').length, 1);
});

test('does nothing when the payments group is not set up', async () => {
  const { deps } = setup();
  deps.config.payments.groupId = null;
  assert.equal(await scanPayments(deps), 0);
});

test('a picture the gateway no longer has is skipped without crashing the scan', async () => {
  const { deps } = setup({ payClient: { history: async () => [{ id: 'Z', type: 'image', timestamp: Math.floor(Date.parse('2026-11-24T15:10:00+05:30') / 1000), body: 'Old one' }], media: async () => null } });
  assert.equal(await scanPayments(deps), 1);
  assert.equal(deps.state.data.payLog.items[0].amount, 0);
});

test('the evening summary lists today once', async () => {
  const { deps, sent } = setup();
  await scanPayments(deps);
  assert.equal(await maybeSendPaymentSummary(deps), true);
  assert.match(sent[0].text, /Happy kharar, ₹6,000, UPI/);
  assert.equal(await maybeSendPaymentSummary(deps), false);
});
