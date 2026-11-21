'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_SEEN = 5000;

/**
 * Small JSON-file store: handled message ids, broadcast opt-outs, human handoff
 * windows, pending follow-ups and per-chat reply counts. One process, one file.
 * Writes are atomic (temp file then rename).
 */
class State {
  constructor(file) {
    this.file = file || null;
    this.data = { seen: [], optOut: {}, handoff: {}, pending: {}, replies: {} };
    if (this.file) this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw };
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

  /** Remember ids of messages the bot sent, so a person's own replies can be told apart. */
  rememberBotMessage(id) {
    this.data.botMsgs = this.data.botMsgs || [];
    this.data.botMsgs.push(String(id));
    if (this.data.botMsgs.length > 2000) this.data.botMsgs.splice(0, this.data.botMsgs.length - 2000);
    this._save();
  }
  isBotMessage(id) {
    return (this.data.botMsgs || []).includes(String(id));
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

  setPending(chatId, kind, ms, now = Date.now()) {
    this.data.pending[chatId] = { kind, until: now + ms };
    this._save();
  }
  takePending(chatId, now = Date.now()) {
    const p = this.data.pending[chatId];
    if (!p) return null;
    delete this.data.pending[chatId];
    this._save();
    return p.until > now ? p.kind : null;
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
}

module.exports = { State };
