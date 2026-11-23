'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maybeSendStaffReports } = require('../src/staffreports');
const { sheetToSvgPages, simplify } = require('../src/sheetimage');
const { State } = require('../src/state');

const rows = [
  ['NAVNEET GORA - OUTSTANDING'],
  ['As of 23 Nov 2026'],
  ['#', 'Party', 'Salesperson', 'City', 'Mobile', 'Total Outstanding', 'Oldest Bill Age', '0-10 days', '11-20 days', '21-30 days', '31-45 days', '46-60 days', '60+ days', 'Older/Opening Bal'],
  [1, 'RAJ ENTERPRISES', 'Navneet', 'Chandigarh', '9694996386', 464708.4, 52, 5200, 135620, 76800, 100000, 147088, 0, 0],
];

test('the sheet becomes readable pages with the right totals', () => {
  const s = simplify(rows);
  assert.deepEqual(s[2].slice(0, 6), ['#', 'Party', 'City', 'Mobile', 'Outstanding', 'Oldest bill (days)']);
  assert.deepEqual(s[3].slice(5), [52, 217620, 247088, 0]);
  const pages = sheetToSvgPages(rows);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /RAJ ENTERPRISES/);
  assert.match(pages[0], /4,64,708/);
});

function setup(over = {}) {
  const sent = [];
  const t = Date.parse('2026-11-24T12:00:00+05:30');
  const deps = {
    state: new State(null), now: () => t, sleep: async () => {}, log: () => {},
    config: { staffChat: '919999900000@c.us', staffReports: { url: 'https://x/y.xlsx', hour: 11, lastHour: 19, map: [{ sheet: 'Navneet Gora', name: 'Navneet', chat: '918437842722@c.us' }, { sheet: 'Missing', name: 'Nobody', chat: '911@c.us' }] } },
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('PK\u0003\u0004data') }),
    readWorkbook: async () => new Map([['Navneet Gora', rows]]),
    render: async () => ['AAA', 'BBB'],
    openwa: {
      sendImage: async (chat, b64, cap) => { sent.push({ chat, b64, cap }); return { messageId: 'I' + sent.length }; },
      sendText: async (chat, text) => { sent.push({ chat, text }); return { messageId: 'T' + sent.length }; },
    },
    ...over,
  };
  return { deps, sent };
}

test('sends each person their pages once, tells the owner, and skips a sheet that did not change', async () => {
  const { deps, sent } = setup();
  assert.equal(await maybeSendStaffReports(deps), 1);
  assert.equal(sent[0].chat, '918437842722@c.us');
  assert.match(sent[0].cap, /Hi Navneet, your outstanding list as of 24 Nov 2026/);
  assert.equal(sent[1].cap, 'Page 2 of 2');
  assert.match(sent[2].text, /sent to 1 of 2 people. Problems: Nobody \(sheet not found\)/);
  assert.ok(!sent.some((m) => /[—–]/.test(m.cap || m.text || '')));
  deps._srAt = 0;
  assert.equal(await maybeSendStaffReports(deps), 0, 'already done today');
});

test('does nothing before the hour, and an old file is not sent again', async () => {
  const early = setup({ now: () => Date.parse('2026-11-24T09:00:00+05:30') });
  assert.equal(await maybeSendStaffReports(early.deps), 0);
  assert.equal(early.sent.length, 0);

  const { deps, sent } = setup();
  await maybeSendStaffReports(deps);
  const n = sent.length;
  deps.state.data.staffReport.date = '2026-11-23';
  deps._srAt = 0;
  assert.equal(await maybeSendStaffReports(deps), 0, 'same file as yesterday');
  assert.equal(sent.length, n);
});

test('a link that does not return an Excel file is reported in the log and nothing is sent', async () => {
  const { deps, sent } = setup({ fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>') }) });
  assert.equal(await maybeSendStaffReports(deps), 0);
  assert.equal(sent.length, 0);
});
