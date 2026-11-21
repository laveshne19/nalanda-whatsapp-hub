'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { istDate } = require('./util');

const MAX_SEEN = 5000;
const HOUR = 3600 * 1000;
const STATS_DAYS = 35;

/**
 * Small JSON-file store for one number: handled message ids, broadcast opt-outs, human
 * handoff windows, pending follow-ups, per-chat reply counts, daily stats and website leads.
 * Writes are atomic (temp file then rename), file mode 600.
 */
class State {
  constructor(file) {
    this.file = file || null;
    this.data = {
      seen: [], optOut: {}, handoff: {}, pending: {}, replies: {}, botMsgs: [],
      stats: {}, leads: {}, lastReportDate: null, intake: [], leadSends: [],
    };
    if (this.file) this._load();
  }

  _load() {
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[state] could not read state file, starting empty:', e.code || e.message);
    }
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[state] save failed:', e.code || e.message);
    }
  }

  /** @returns {boolean} true if this key was already handled */
  seen(key) {
    if (this.data.seen.includes(key)) return true;
    this.data.seen.push(key);
    if (this.data.seen.length > MAX_SEEN) this.data.seen.splice(0, this.data.seen.length - MAX_SEEN);
    this._save();
    return false;
  }

  rememberBotMessage(id) {
    this.data.botMsgs.push(String(id));
    if (this.data.botMsgs.length > 2000) this.data.botMsgs.splice(0, this.data.botMsgs.length - 2000);
    this._save();
  }
  /** Remember the words the bot sent to a chat for a short while, in case message ids do not line up. */
  rememberBotText(chatId, text, now = Date.now()) {
    const key = crypto.createHash('sha1').update(`${chatId}|${String(text).replace(/\s+/g, ' ').trim()}`).digest('hex');
    this._botTexts = this._botTexts || new Map();
    this._botTexts.set(key, now);
    if (this._botTexts.size > 500) this._botTexts.delete(this._botTexts.keys().next().value);
  }
  wasBotText(chatId, text, now = Date.now(), windowMs = 10 * 60 * 1000) {
    if (!this._botTexts) return false;
    const key = crypto.createHash('sha1').update(`${chatId}|${String(text || '').replace(/\s+/g, ' ').trim()}`).digest('hex');
    const at = this._botTexts.get(key);
    return Boolean(at) && now - at < windowMs;
  }
  isBotMessage(id) {
    return this.data.botMsgs.includes(String(id));
  }

  isOptedOut(chatId) {
    return Boolean(this.data.optOut[chatId]);
  }
  setOptOut(chatId, value) {
    if (value) this.data.optOut[chatId] = Date.now();
    else delete this.data.optOut[chatId];
    this._save();
  }

  handoffActive(chatId, now = Date.now()) {
    const until = this.data.handoff[chatId];
    if (!until) return false;
    if (until <= now) {
      delete this.data.handoff[chatId];
      this._save();
      return false;
    }
    return true;
  }
  startHandoff(chatId, ms, now = Date.now()) {
    this.data.handoff[chatId] = now + ms;
    this._save();
  }

  /** A short-lived "I asked, waiting for your answer" marker, with optional details. */
  setPending(chatId, kind, ms, now = Date.now(), meta = null) {
    this.data.pending[chatId] = { kind, until: now + ms, meta };
    this._save();
  }
  peekPending(chatId, now = Date.now()) {
    const p = this.data.pending[chatId];
    return p && p.until > now ? p : null;
  }
  clearPending(chatId) {
    if (this.data.pending[chatId]) {
      delete this.data.pending[chatId];
      this._save();
    }
  }

  /** Per-chat reply budget. Returns true if another reply is allowed (and counts it). */
  allowReply(chatId, limit, windowMs, now = Date.now()) {
    const list = (this.data.replies[chatId] || []).filter((t) => now - t < windowMs);
    if (list.length >= limit) {
      this.data.replies[chatId] = list;
      return false;
    }
    list.push(now);
    this.data.replies[chatId] = list;
    this._save();
    return true;
  }

  // ---- daily numbers for the report ----
  _day(now) {
    const d = istDate(now);
    if (!this.data.stats[d]) {
      this.data.stats[d] = { chats: [] };
      const keys = Object.keys(this.data.stats).sort();
      while (keys.length > STATS_DAYS) delete this.data.stats[keys.shift()];
    }
    return this.data.stats[d];
  }
  bump(name, now = Date.now(), n = 1) {
    const day = this._day(now);
    day[name] = (day[name] || 0) + n;
    this._save();
  }
  noteChat(chatId, now = Date.now()) {
    const day = this._day(now);
    if (!day.chats.includes(chatId)) day.chats.push(chatId);
  }
  statsFor(dateStr) {
    const day = this.data.stats[dateStr] || { chats: [] };
    return { ...day, chats: day.chats.length };
  }
  lastReportDate() {
    return this.data.lastReportDate;
  }
  setLastReportDate(d) {
    this.data.lastReportDate = d;
    this._save();
  }

  // ---- website leads ----
  saveLead(lead) {
    this.data.leads[lead.ref] = lead;
    this._save();
  }
  getLead(ref) {
    return this.data.leads[ref] || null;
  }
  allLeads() {
    return Object.values(this.data.leads);
  }
  /** A lead we are still collecting answers from, matched by chat id or phone. */
  collectingLeadFor(chatId, phoneKeyValue) {
    return (
      this.allLeads().find(
        (l) =>
          !l.completed &&
          l.started &&
          (l.chatId === chatId || (phoneKeyValue && l.phone && l.phone.slice(-10) === phoneKeyValue)),
      ) || null
    );
  }
  /** A form lead we have not talked to yet, matched by phone, from the last 48 hours. */
  unstartedLeadFor(phoneKeyValue, now = Date.now()) {
    if (!phoneKeyValue) return null;
    return (
      this.allLeads().find(
        (l) => !l.completed && !l.started && l.phone && l.phone.slice(-10) === phoneKeyValue && now - l.createdAt < 48 * HOUR,
      ) || null
    );
  }
  recentLeadByPhone(phone, now, windowMs = 24 * HOUR) {
    return this.allLeads().find((l) => l.phone === phone && now - l.createdAt < windowMs) || null;
  }
  /** Caps how many website submissions are accepted per hour (abuse brake). */
  allowIntake(limitPerHour, now = Date.now()) {
    this.data.intake = this.data.intake.filter((t) => now - t < HOUR);
    if (this.data.intake.length >= limitPerHour) return false;
    this.data.intake.push(now);
    this._save();
    return true;
  }
  /** Caps first messages the bot starts by itself per day. */
  allowProactive(limitPerDay, now = Date.now()) {
    this.data.leadSends = this.data.leadSends.filter((t) => now - t < 24 * HOUR);
    if (this.data.leadSends.length >= limitPerDay) return false;
    this.data.leadSends.push(now);
    this._save();
    return true;
  }
}

module.exports = { State };
