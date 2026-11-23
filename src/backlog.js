'use strict';
const { handleEvent } = require('./handler');

/**
 * Catch-up scan. Live messages are answered the moment they arrive; this goes back over chats that still
 * show unread (for example messages from before the bot was switched on, or sent while it was down),
 * oldest first, and runs each one through exactly the same rules as a live message.
 * Each unread message is handled once. A chat the team already opened on the phone is not unread, so it is skipped.
 */
async function scanBacklog(deps) {
  const { state, config } = deps;
  const cfg = config.backlog;
  if (!cfg || !cfg.enabled) return 0;
  const now = deps.now ? deps.now() : Date.now();
  if (deps._lastScan && now - deps._lastScan < cfg.everyMinutes * 60 * 1000) return 0;
  deps._lastScan = now;

  let chats;
  try {
    chats = await deps.openwa.listChats(150);
  } catch (e) {
    (deps.log || (() => {}))(`[backlog] chat list failed: ${e.message}`);
    return 0;
  }

  const toMs = (t) => (t > 1e12 ? t : t * 1000);
  const todo = chats
    .filter((c) => c && c.id && !c.isGroup && c.kind !== 'group' && !/@(g\.us|broadcast)$/.test(c.id) && !/status@/.test(c.id))
    .filter((c) => Number(c.unreadCount) > 0 && c.timestamp && now - toMs(c.timestamp) <= cfg.maxAgeDays * 86400 * 1000)
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let handled = 0;
  for (const c of todo) {
    if (handled >= cfg.maxPerRun) break;
    const key = `backlog:${c.id}:${c.timestamp}`;
    if (state.data.seen.includes(key)) continue;
    try {
      const r = await handleEvent(
        {
          event: 'message.received',
          idempotencyKey: key,
          data: { id: key, chatId: c.id, from: c.id, body: String(c.lastMessage || ''), type: c.lastMessageType || 'chat', isGroup: false },
        },
        deps,
      );
      handled += 1;
      if (r && r.action === 'replied') await sleep(cfg.pauseMs);
    } catch (e) {
      (deps.log || (() => {}))(`[backlog] ${e.message}`);
    }
  }
  if (handled) state.bump('backlog_handled', now);
  return handled;
}

module.exports = { scanBacklog };
