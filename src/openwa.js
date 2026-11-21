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

  return { sendText };
}

module.exports = { verifySignature, createClient };
