'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maybeSendStaffUpdates, cleanText } = require('../src/staffupdates');
const { State } = require('../src/state');

const file = {
  asOf: '2026-11-24',
  messages: [
    { key: 'Navneet', chat: '918437842722@c.us', session: 'hub', text: 'Hi Navneet, sales 75% of target' },
    { key: 'Team', chat: '120363408432965121@g.us', session: 'pay', text: 'Hi team – sales 27%' },
  ],
};

function setup(over = {}) {
  const sent = [];
  const t = Date.parse('2026-11-25T12:00:00+05:30');
  const mk = (tag) => ({ sendText: async (chat, text) => { sent.push({ tag, chat, text }); return { messageId: tag + sent.length }; } });
  const deps = {
    state: new State(null), now: () => t, sleep: async () => {}, log: () => {},
    config: { staffChat: '919999900000@c.us', staffUpdates: { url: 'https://x/u.json', hour: 11, lastHour: 19 } },
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(file) }),
    openwa: mk('hub'),
    payClient: mk('pay'),
    ...over,
  };
  return { deps, sent };
}

test('cleanText never lets a dash through', () => {
  assert.equal(cleanText('a — b – c'), 'a , b , c');
});

test('sends each message from the right number, once a day, and tells the owner', async () => {
  const { deps, sent } = setup();
  assert.equal(await maybeSendStaffUpdates(deps), 2);
  assert.equal(sent[0].tag, 'hub');
  assert.equal(sent[1].tag, 'pay');
  assert.equal(sent[1].text, 'Hi team , sales 27%');
  assert.match(sent[2].text, /Target messages sent: 2 of 2/);
  const n = sent.length;
  assert.equal(await maybeSendStaffUpdates(deps), 0);
  assert.equal(sent.length, n);
});

test('does not send before the hour, or when the file is the same as last time', async () => {
  const early = setup({ now: () => Date.parse('2026-11-25T09:00:00+05:30') });
  assert.equal(await maybeSendStaffUpdates(early.deps), 0);
  assert.equal(early.sent.length, 0);

  const { deps, sent } = setup();
  deps.state.data.staffUpdate = { hash: null, asOf: '2026-11-24', date: '2026-11-24' };
  assert.equal(await maybeSendStaffUpdates(deps), 0);
  assert.equal(sent.length, 0);
});

test('a missing second number is reported, not crashed on', async () => {
  const { deps, sent } = setup({ payClient: null });
  assert.equal(await maybeSendStaffUpdates(deps), 1);
  assert.match(sent[sent.length - 1].text, /not connected to the hub/);
});
