'use strict';
const crypto = require('node:crypto');
const { notifyStaff } = require('./notify');
const { istDate, istHour } = require('./util');

const TRY_GAP_MS = 20 * 60 * 1000;
const PAUSE_MS = 12000;

/** Download the daily JSON the office job publishes. Returns the parsed object. */
async function fetchUpdates(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`updates download failed: HTTP ${res.status}`);
  const raw = await res.text();
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error('the link did not return the updates file');
  }
  if (!j || !Array.isArray(j.messages)) throw new Error('the updates file has no messages');
  return { json: j, raw };
}

/** Only plain human text goes to people: no dashes used as punctuation, sane length. */
function cleanText(t) {
  return String(t || '')
    .replace(/[–—]/g, ',')
    .slice(0, 3500)
    .trim();
}

/**
 * Once a day, after the office job has published fresh numbers, send each salesperson their own
 * target, achievement and outstanding. Waits (retrying every 20 minutes) until the file is new.
 * Each message names its chat and which number sends it: "hub" (main number) or "pay" (payment reminders).
 */
async function maybeSendStaffUpdates(deps) {
  const { state, config } = deps;
  const cfg = config.staffUpdates;
  if (!cfg || !cfg.url) return 0;
  const now = deps.now ? deps.now() : Date.now();
  const today = istDate(now);
  const su = state.data.staffUpdate || (state.data.staffUpdate = { hash: null, date: null });
  if (su.date === today || istHour(now) < cfg.hour) return 0;
  if (deps._suAt && now - deps._suAt < TRY_GAP_MS) return 0;
  deps._suAt = now;
  const log = deps.log || (() => {});

  let got;
  try {
    got = await fetchUpdates(cfg.url, deps.fetchImpl || fetch);
  } catch (e) {
    log(`[staffupdates] ${e.message}`);
    return 0;
  }
  const hash = crypto.createHash('sha256').update(got.raw).digest('hex');
  if (hash === su.hash || got.json.asOf === su.asOf) {
    if (istHour(now) >= cfg.lastHour) {
      su.date = today;
      state._save();
      await notifyStaff(deps, 'The daily targets file was not updated today, so no target messages went to the team.');
    }
    return 0;
  }

  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let sent = 0;
  const problems = [];
  for (const m of got.json.messages) {
    const text = cleanText(m.text);
    if (!m.chat || !text) continue;
    const client = m.session === 'pay' ? deps.payClient : deps.openwa;
    if (!client) {
      problems.push(`${m.key || m.chat} (that number is not connected to the hub)`);
      continue;
    }
    try {
      state.rememberBotText(m.chat, text, now);
      await client.sendText(m.chat, text);
      sent += 1;
    } catch (e) {
      problems.push(`${m.key || m.chat} (${e.message})`);
    }
    await sleep(PAUSE_MS);
  }
  su.hash = hash;
  su.asOf = got.json.asOf || null;
  su.date = today;
  state._save();
  await notifyStaff(deps, `Target messages sent: ${sent} of ${got.json.messages.length}.${problems.length ? ` Problems: ${problems.join(', ')}.` : ''}`);
  return sent;
}

module.exports = { maybeSendStaffUpdates, fetchUpdates, cleanText };
