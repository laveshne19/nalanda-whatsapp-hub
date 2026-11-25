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
    backlog: {
      enabled: (env.BACKLOG_SCAN || 'true').trim().toLowerCase() !== 'false',
      everyMinutes: Number(env.BACKLOG_EVERY_MINUTES || 30),
      maxPerRun: Number(env.BACKLOG_MAX_PER_RUN || 25),
      maxAgeDays: Number(env.BACKLOG_MAX_AGE_DAYS || 7),
      pauseMs: Number(env.BACKLOG_PAUSE_MS || 8000),
    },
    staffReports: {
      url: (env.STAFF_REPORT_URL || '').trim() || null,
      hour: Number(env.STAFF_REPORT_HOUR_IST || 11),
      lastHour: Number(env.STAFF_REPORT_LAST_HOUR_IST || 19),
      map: (() => {
        try {
          const m = JSON.parse(env.STAFF_REPORT_MAP || '[]');
          return Array.isArray(m) ? m.filter((x) => x && x.sheet && x.chat) : [];
        } catch {
          return [];
        }
      })(),
    },
    // Daily target messages: a JSON file the office job publishes (Google Drive link).
    staffUpdates: {
      url: (env.STAFF_UPDATE_URL || '').trim() || null,
      hour: Number(env.STAFF_UPDATE_HOUR_IST || 11),
      lastHour: Number(env.STAFF_UPDATE_LAST_HOUR_IST || 19),
    },
    // The payment-reminders number: sends to the Ludhiana group and reads the payments group.
    payOpenwa:
      (env.PAYMENTS_OPENWA_KEY || '').trim() && (env.PAYMENTS_SESSION_ID || '').trim()
        ? { baseUrl: need('OPENWA_URL'), apiKey: env.PAYMENTS_OPENWA_KEY.trim(), sessionId: env.PAYMENTS_SESSION_ID.trim() }
        : null,
    payments: {
      groupId: (env.PAYMENTS_GROUP_ID || '').trim() || null,
      everyMinutes: Number(env.PAYMENTS_EVERY_MINUTES || 30),
      maxPerRun: Number(env.PAYMENTS_MAX_PER_RUN || 10),
      pauseMs: Number(env.PAYMENTS_PAUSE_MS || 7000),
      summaryHour: Number(env.PAYMENTS_SUMMARY_HOUR_IST || 20),
    },
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
