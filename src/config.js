'use strict';
const { createTokenProvider } = require('./shopify');

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
  const shopClientId = (env.SHOPIFY_CLIENT_ID || '').trim();
  const shopClientSecret = (env.SHOPIFY_CLIENT_SECRET || '').trim();
  const shopApiVersion = (env.SHOPIFY_API_VERSION || '2026-10').trim();

  return {
    port: Number(env.PORT || 8080),
    webhookSecret,
    openwa: {
      baseUrl: need('OPENWA_URL'),
      apiKey: need('OPENWA_API_KEY'),
      sessionId: need('OPENWA_SESSION_ID'),
    },
    shopify:
      shopDomain && (shopToken || (shopClientId && shopClientSecret))
        ? {
            domain: shopDomain,
            apiVersion: shopApiVersion,
            auth: createTokenProvider({
              domain: shopDomain,
              clientId: shopClientId,
              clientSecret: shopClientSecret,
              staticToken: shopToken,
            }),
          }
        : null,
    // Alerts for bulk enquiries, cancellations and leads go here. Also the only chat allowed to
    // ask the bot for the report ("report", "leads", "done REF").
    staffChat: (env.STAFF_CHAT_ID || '').trim() || null,
    wholesaleContact: (env.WHOLESALE_CONTACT || '').trim() || null,
    reportHourIst: Number(env.REPORT_HOUR_IST || 20),
    shipmentsHourIst: Number(env.SHIPMENTS_HOUR_IST || 18),
    businessHours: (env.BUSINESS_HOURS || '').trim() || null,
    hubWebhookUrl: (env.HUB_WEBHOOK_URL || '').trim() || null,
    leads: {
      secret: (env.LEADS_SECRET || '').trim() || null,
      proactive: (env.LEAD_PROACTIVE || 'true').trim().toLowerCase() !== 'false',
      notifyOnCreate: (env.LEAD_NOTIFY_ON_CREATE || 'true').trim().toLowerCase() !== 'false',
      proactivePerDay: Number(env.LEAD_PROACTIVE_PER_DAY || 30),
      intakePerHour: Number(env.LEAD_INTAKE_PER_HOUR || 60),
      staleMinutes: Number(env.LEAD_STALE_MINUTES || 30),
    },
    statePath: (env.STATE_PATH || './data/state.json').trim(),
    // When a person replies by hand in a chat, the bot stays quiet there. On unless switched off.
    staffReplyPauses: (env.STAFF_REPLY_PAUSES || 'true').trim().toLowerCase() !== 'false',
    limits: {
      repliesPerChatPerHour: Number(env.REPLIES_PER_CHAT_PER_HOUR || 10),
      handoffHours: Number(env.HANDOFF_HOURS || 12),
    },
  };
}

module.exports = { fromEnv };
