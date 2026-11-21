'use strict';

function fromEnv(env = process.env) {
  const need = (k) => {
    const v = (env[k] || '').trim();
    if (!v) throw new Error(`Missing required setting ${k}`);
    return v;
  };

  const webhookSecret = need('WEBHOOK_SECRET');
  if (webhookSecret.length < 16) throw new Error('WEBHOOK_SECRET must be at least 16 characters');

  const shopDomain = (env.SHOPIFY_SHOP_DOMAIN || '').trim();
  const shopToken = (env.SHOPIFY_ADMIN_TOKEN || '').trim();

  return {
    port: Number(env.PORT || 8080),
    webhookSecret,
    openwa: {
      baseUrl: need('OPENWA_URL'),
      apiKey: need('OPENWA_API_KEY'),
      sessionId: need('OPENWA_SESSION_ID'),
    },
    shopify:
      shopDomain && shopToken
        ? { domain: shopDomain, token: shopToken, apiVersion: (env.SHOPIFY_API_VERSION || '2026-10').trim() }
        : null,
    staffChat: (env.STAFF_CHAT_ID || '').trim() || null,
    businessHours: (env.BUSINESS_HOURS || '').trim() || null,
    statePath: (env.STATE_PATH || './data/state.json').trim(),
    // Off until verified on the live number: needs OpenWA message ids to match send responses.
    staffReplyPauses: (env.STAFF_REPLY_PAUSES || '').trim().toLowerCase() === 'true',
    limits: {
      repliesPerChatPerHour: Number(env.REPLIES_PER_CHAT_PER_HOUR || 10),
      handoffHours: Number(env.HANDOFF_HOURS || 12),
    },
  };
}

module.exports = { fromEnv };
