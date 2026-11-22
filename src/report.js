'use strict';
const { istDate, istHour, istPretty } = require('./util');
const { leadAlert, T } = require('./templates');
const { summary } = require('./leads');
const { notifyStaff, sendDirect } = require('./notify');

const MIN = 60 * 1000;
const HOUR_MS = 60 * MIN;
const RETRY_GAP_MS = 10 * MIN;
const MAX_TRIES = 3;

function openCalls(state) {
  return state
    .allLeads()
    .filter((l) => l.status === 'needs_call')
    .sort((a, b) => a.createdAt - b.createdAt);
}

function leadsText(state) {
  const open = openCalls(state);
  if (!open.length) return 'No leads waiting for a call.';
  const lines = open.slice(0, 15).map((l) => `${l.ref} ${l.name || 'No name'} +${l.phone}: ${summary(l)}`);
  const more = open.length > 15 ? `\n...and ${open.length - 15} more.` : '';
  return `Leads to call (${open.length}):\n${lines.join('\n')}${more}\nReply "done REF" when you have called.`;
}

function buildReport(state, config, now = Date.now()) {
  const s = state.statsFor(istDate(now));
  const n = (k) => s[k] || 0;
  const lines = [
    `Nalanda WhatsApp report, ${istPretty(now)}`,
    `Chats today: ${s.chats}. Messages in: ${n('in')}. Bot replies: ${n('replied')}.`,
    `Order tracking: ${n('tracking_answered')} answered, ${n('tracking_unverified')} not verified.`,
    `Cancel requests: ${n('cancel_requests')}.`,
    `Bulk and wholesale enquiries: ${n('bulk')}.`,
    `Website leads: ${n('lead_new')} new. Hot ${n('lead_hot')}, warm ${n('lead_warm')}, small ${n('lead_low')}, ` +
      `single piece ${n('lead_single')}, not interested ${n('lead_closed')}.`,
    `Passed to the team: ${n('handoff')}.`,
    `Left for your team (the bot stayed quiet): ${n('silent')}. Machine messages ignored: ${n('automated')}. ` +
      `Chats where your staff replied by hand: ${n('staff_replies')}.`,
  ];
  const problems = n('send_failed') + n('rate_limited');
  if (problems) lines.push(`Needs a look: ${n('send_failed')} failed sends, ${n('rate_limited')} held back by limits.`);
  lines.push('', leadsText(state));
  return lines.join('\n');
}

/**
 * Send the daily report once the report hour (India time) has passed.
 * A failed attempt is retried at most 3 times, 10 minutes apart, so a problem can never
 * hammer OpenWA's failure breaker.
 */
async function maybeSendDailyReport(deps) {
  const { state, config } = deps;
  const now = deps.now ? deps.now() : Date.now();
  if (!config.staffChat) return false;
  const today = istDate(now);
  if (istHour(now) < config.reportHourIst || state.lastReportDate() === today) return false;

  const t = (state._reportTry = state._reportTry && state._reportTry.date === today ? state._reportTry : { date: today, count: 0, at: 0 });
  if (t.count >= MAX_TRIES || now - t.at < RETRY_GAP_MS) return false;
  t.count += 1;
  t.at = now;

  const ok = await notifyStaff(deps, buildReport(state, config, now));
  if (ok) state.setLastReportDate(today);
  return ok;
}

/**
 * Leads that were asked questions but never answered still reach a person.
 * After the stale window the lead moves to "needs a call" and the owner is told.
 */
async function sweepLeads(deps) {
  const { state, config } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const staleMs = config.leads.staleMinutes * MIN;
  let alerted = 0;

  for (const lead of state.allLeads()) {
    if (lead.completed || lead.status === 'done') continue;
    const waitingTooLong = lead.status === 'asking' && now - lead.lastActivity >= staleMs;
    if (waitingTooLong) {
      lead.stale = true;
      lead.status = 'needs_call';
      state.saveLead(lead);
    }
    if (lead.stale && !lead.staleAlerted && (lead.alertTries || 0) < MAX_TRIES && now - (lead.alertAt || 0) >= RETRY_GAP_MS) {
      lead.alertTries = (lead.alertTries || 0) + 1;
      lead.alertAt = now;
      const ok = await notifyStaff(deps, leadAlert(lead, 'stale'));
      if (ok) {
        lead.staleAlerted = true;
        alerted += 1;
      }
      state.saveLead(lead);
    }
  }
  return alerted;
}

const FU_GAP_MS = 5 * HOUR_MS;
const FU_PER_DAY = 2;
const FU_DAYS = 4;

/**
 * A website enquiry that stays silent gets up to 2 gentle follow-ups a day for 4 days, then we stop.
 * Any reply from the customer ends the follow-ups (the normal flow takes over).
 */
async function followUpLeads(deps) {
  const { state } = deps;
  const now = deps.now ? deps.now() : Date.now();
  let sent = 0;
  for (const lead of state.allLeads()) {
    if (lead.completed || lead.status === 'done' || !lead.stale || !lead.chatId || state.isOptedOut(lead.chatId)) continue;
    if (lead.fuStart && (now - lead.fuStart >= FU_DAYS * 24 * HOUR_MS || lead.lastActivity !== lead.fuBase)) continue;
    if (now - (lead.fuAt || 0) < FU_GAP_MS) continue;
    const day = istDate(now);
    if (lead.fuDay === day && (lead.fuToday || 0) >= FU_PER_DAY) continue;
    if (istHour(now) < 8 || istHour(now) >= 22) continue; // a nudge, not a 3 AM ping
    const ok = await sendDirect(deps, lead.chatId, T.leadFollowUp(lead, lead.fuCount || 0));
    if (!ok) continue;
    if (!lead.fuStart) { lead.fuStart = now; lead.fuBase = lead.lastActivity; }
    lead.fuCount = (lead.fuCount || 0) + 1;
    lead.fuAt = now;
    lead.fuToday = lead.fuDay === day ? (lead.fuToday || 0) + 1 : 1;
    lead.fuDay = day;
    state.saveLead(lead);
    state.bump('lead_followups', now);
    sent += 1;
  }
  return sent;
}

module.exports = { followUpLeads, buildReport, leadsText, maybeSendDailyReport, sweepLeads, openCalls };
