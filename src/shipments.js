'use strict';
const { listRecentShipments, phoneKey } = require('./shopify');
const { T } = require('./templates');
const { sendDirect, notifyStaff } = require('./notify');
const { istDate, istHour } = require('./util');

const MAX_PER_RUN = 80;
const MAX_TRIES = 3;
const RETRY_GAP_MS = 10 * 60 * 1000;
const PAUSE_MS = 6000; // gentle pace between messages so WhatsApp does not see a burst

/**
 * Once a day (default 6 PM IST) send every customer whose order got a tracking number
 * in the last day a WhatsApp with the courier and tracking ID. Each order is sent once.
 */
async function maybeSendShipments(deps) {
  const { state, config } = deps;
  const now = deps.now ? deps.now() : Date.now();
  if (!config.shopify) return 0;
  const today = istDate(now);
  if (istHour(now) < config.shipmentsHourIst || state.lastShipDate() === today) return 0;

  const t = (state._shipTry = state._shipTry && state._shipTry.date === today ? state._shipTry : { date: today, count: 0, at: 0 });
  if (t.count >= MAX_TRIES || now - t.at < RETRY_GAP_MS) return 0;
  t.count += 1;
  t.at = now;

  let list;
  try {
    list = await listRecentShipments({ shopify: config.shopify, fetchImpl: deps.fetchImpl, now: () => now });
  } catch (e) {
    (deps.log || (() => {}))(`[shipments] lookup failed: ${e.message}`);
    return 0;
  }

  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let sent = 0;
  let failed = 0;
  const noPhone = [];
  for (const o of list) {
    if (state.shipNotified(o.name)) continue;
    const key = phoneKey(o.phone);
    if (!key) { noPhone.push(o.name); state.markShipNotified(o.name); continue; }
    if (sent + failed >= MAX_PER_RUN) { failed++; continue; }
    const chatId = `91${key}@c.us`;
    if (state.data.optOut[chatId]) { state.markShipNotified(o.name); continue; }
    if (await sendDirect(deps, chatId, T.shipped(o.name, o.fulfillments))) {
      state.markShipNotified(o.name);
      state.bump('shipping_sent', now);
      sent++;
      await sleep(PAUSE_MS);
    } else {
      failed++;
    }
  }
  if (!failed) state.setLastShipDate(today);
  if (sent || noPhone.length) {
    const extra = noPhone.length ? ` No phone number on: ${noPhone.map((n) => '#' + String(n).replace(/^#/, '')).join(', ')}.` : '';
    await notifyStaff(deps, `Tracking details sent on WhatsApp to ${sent} customer${sent === 1 ? '' : 's'}.${extra}`);
  }
  return sent;
}

module.exports = { maybeSendShipments };
