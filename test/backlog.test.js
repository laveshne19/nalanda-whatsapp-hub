'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanBacklog } = require('../src/backlog');
const { State } = require('../src/state');

const NOW = Date.parse('2026-11-23T11:00:00+05:30');
const s = (iso) => Math.floor(Date.parse(iso) / 1000);

function setup(chats) {
  const sent = [];
  const deps = {
    state: new State(null), now: () => NOW, sleep: async () => {}, log: () => {},
    config: {
      backlog: { enabled: true, everyMinutes: 30, maxPerRun: 25, maxAgeDays: 7, pauseMs: 0 },
      shopify: null, staffChat: '919999900000@c.us', businessHours: '11am to 7pm', staffReplyPauses: false,
      limits: { repliesPerChatPerHour: 10, handoffHours: 12 }, wholesaleContact: null,
    },
    openwa: {
      listChats: async () => chats,
      sendText: async (chatId, text) => { sent.push({ chatId, text }); return { messageId: 'M' + sent.length }; },
    },
  };
  return { deps, sent };
}
const chat = (id, body, iso, over = {}) => ({ id, name: 'x', isGroup: false, kind: 'user', unreadCount: 1, timestamp: s(iso), lastMessage: body, lastMessageType: 'chat', ...over });

test('replies to unread chats oldest first and only once', async () => {
  const { deps, sent } = setup([
    chat('111@lid', 'hi', '2026-11-22T10:00:00Z'),
    chat('222@lid', 'bulk order for 500 pcs', '2026-11-21T10:00:00Z'),
  ]);
  assert.equal(await scanBacklog(deps), 2);
  assert.equal(sent[0].chatId, '222@lid', 'older message first');
  assert.ok(sent.some((m) => m.chatId === '919999900000@c.us'), 'owner alerted about the bulk enquiry');
  deps._lastScan = 0;
  const before = sent.length;
  assert.equal(await scanBacklog(deps), 0, 'same unread message is not handled twice');
  assert.equal(sent.length, before);
});

test('skips read chats, groups, and very old messages', async () => {
  const { deps, sent } = setup([
    chat('1@lid', 'hi', '2026-11-22T10:00:00Z', { unreadCount: 0 }),
    chat('2@g.us', 'hi', '2026-11-22T10:00:00Z', { isGroup: true }),
    chat('3@lid', 'hi', '2026-10-01T10:00:00Z'),
  ]);
  assert.equal(await scanBacklog(deps), 0);
  assert.equal(sent.length, 0);
});

test('runs at most once per interval and can be switched off', async () => {
  const { deps } = setup([chat('1@lid', 'hi', '2026-11-22T10:00:00Z')]);
  assert.equal(await scanBacklog(deps), 1);
  assert.equal(await scanBacklog(deps), 0);
  deps._lastScan = 0; deps.config.backlog.enabled = false;
  assert.equal(await scanBacklog(deps), 0);
});
