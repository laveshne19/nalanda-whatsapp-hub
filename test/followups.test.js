'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { followUpLeads } = require('../src/report');
const { State } = require('../src/state');

const T0 = Date.parse('2026-11-22T11:00:00+05:30');
const H = 3600e3;

function setup() {
  const sent = [];
  const state = new State(null);
  state.saveLead({ ref: 'ABCDEF', name: 'Ravi Kumar', product: 'power banks', chatId: '919876543210@c.us', status: 'needs_call', stale: true, lastActivity: T0 - 2 * H, createdAt: T0 - 3 * H });
  let now = T0;
  const deps = { state, now: () => now, log: () => {}, config: {}, openwa: { sendText: async (c, t) => { sent.push({ c, t }); return { messageId: 'M' + sent.length }; } } };
  return { deps, sent, state, at: (t) => { now = t; } };
}

test('silent enquiry: at most 2 follow-ups a day for 4 days, then stops', async () => {
  const { deps, sent, at } = setup();
  let total = 0;
  for (let day = 0; day < 6; day++) {
    for (const hr of [0, 6, 12]) {
      at(T0 + day * 24 * H + hr * H);
      total += await followUpLeads(deps);
    }
  }
  assert.equal(total, 8);
  assert.match(sent[0].t, /just checking in on your enquiry about power banks/);
  assert.ok(sent.every((m) => !/[—–]/.test(m.t)));
});

test('a reply from the customer stops the follow-ups', async () => {
  const { deps, sent, state, at } = setup();
  await followUpLeads(deps);
  const lead = state.getLead('ABCDEF');
  lead.lastActivity = T0 + 1 * H; // customer wrote back
  state.saveLead(lead);
  at(T0 + 8 * H);
  assert.equal(await followUpLeads(deps), 0);
  assert.equal(sent.length, 1);
});

test('opted out customers are left alone', async () => {
  const { deps, state } = setup();
  state.setOptOut('919876543210@c.us', true);
  assert.equal(await followUpLeads(deps), 0);
});
