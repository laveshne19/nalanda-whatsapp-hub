'use strict';
const crypto = require('node:crypto');

/**
 * Verify OpenWA's `X-OpenWA-Signature: sha256=<hex>` header (HMAC-SHA256 of the raw body).
 * Fails closed: no secret, no header, or any mismatch means reject.
 */
function verifySignature(rawBody, header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function createClient({ baseUrl, apiKey, sessionId, fetchImpl = fetch, timeoutMs = 15000 }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const enc = encodeURIComponent(sessionId);

  async function sendText(chatId, text) {
    const res = await fetchImpl(`${base}/api/sessions/${enc}/messages/send-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ chatId, text: String(text).slice(0, 4000) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // 429 SEND_PACING_LIMITED is expected when the daily cap is reached
      const err = new Error(`OpenWA send failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    return { messageId: data.messageId || null };
  }

  /** Send a picture (base64 PNG) with an optional caption. */
  async function sendImage(chatId, base64, caption, filename = 'sheet.png') {
    const res = await fetchImpl(`${base}/api/sessions/${enc}/messages/send-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ chatId, base64, mimetype: 'image/png', filename, caption: caption ? String(caption).slice(0, 1000) : undefined }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const err = new Error(`OpenWA image send failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    return { messageId: data.messageId || null };
  }

  /** Recent chats with unread counts, newest first (read only). */
  async function listChats(limit = 150) {
    const res = await fetchImpl(`${base}/api/sessions/${enc}/chats?limit=${Number(limit) || 150}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenWA chat list failed: HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j) ? j : j.data || j.chats || [];
  }

  /**
   * Make sure OpenWA calls this hub: list the session's webhooks, create ours if missing.
   * Safe to run on every start. If a webhook for the url exists it is left alone.
   */
  async function ensureWebhook({ url, secret, events }) {
    const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };
    const listRes = await fetchImpl(`${base}/api/sessions/${enc}/webhooks`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!listRes.ok) throw new Error(`OpenWA webhook list failed: HTTP ${listRes.status}`);
    const existing = await listRes.json();
    const mine = Array.isArray(existing) ? existing.find((w) => w.url === url) : null;
    if (mine) {
      const have = Array.isArray(mine.events) ? mine.events : [];
      const missing = events.filter((e) => !have.includes(e) && !have.includes('*'));
      if (!missing.length) return { created: false, updated: false };
      const upd = await fetchImpl(`${base}/api/sessions/${enc}/webhooks/${encodeURIComponent(mine.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ events: [...new Set([...have, ...events])] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!upd.ok) throw new Error(`OpenWA webhook update failed: HTTP ${upd.status}`);
      return { created: false, updated: true };
    }

    const res = await fetchImpl(`${base}/api/sessions/${enc}/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, events, secret, retryCount: 3 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenWA webhook create failed: HTTP ${res.status}`);
    return { created: true };
  }

  return { sendText, sendImage, listChats, ensureWebhook };
}

module.exports = { verifySignature, createClient };
