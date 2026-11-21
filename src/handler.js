'use strict';
const { classify } = require('./intents');
const { T, orderStatus, staffNote } = require('./templates');
const { lookupOrder, phoneKey } = require('./shopify');

const HOUR = 3600 * 1000;
const BULK_FOLLOWUP_MS = 24 * HOUR;

function senderOf(data) {
  const chatId = data.from;
  const raw = data.senderPhone || (/@c\.us$/.test(chatId || '') ? chatId.split('@')[0] : '');
  return { chatId, phone: phoneKey(raw) ? raw : '' };
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d ? `***${d.slice(-4)}` : 'unknown';
}

/**
 * Handle one verified OpenWA webhook payload. Never throws for bad input.
 * deps: { state, openwa, config, fetchImpl?, log?, now? }
 * @returns {Promise<{action: string, intent?: string}>}
 */
async function handleEvent(payload, deps) {
  const { state, openwa, config } = deps;
  const log = deps.log || (() => {});
  const now = deps.now ? deps.now() : Date.now();
  const data = (payload && payload.data) || {};

  // A person replying from the phone itself pauses the bot for that chat.
  if (payload.event === 'message.sent') {
    if (config.staffReplyPauses && data.id && !state.isBotMessage(data.id) && data.to && !data.isGroup) {
      state.startHandoff(data.to, config.limits.handoffHours * HOUR, now);
      return { action: 'handoff_by_staff' };
    }
    return { action: 'ignored' };
  }
  if (payload.event !== 'message.received') return { action: 'ignored' };

  if (data.isGroup || data.isStatusBroadcast || data.fromMe || !data.from) return { action: 'ignored' };
  if (payload.idempotencyKey && state.seen(payload.idempotencyKey)) return { action: 'duplicate' };

  const { chatId, phone } = senderOf(data);
  const body = typeof data.body === 'string' ? data.body : '';
  const textual = !data.type || data.type === 'chat' || data.type === 'text';
  if (!textual && !body) {
    // images, voice notes and documents go to a person
    return reply(deps, chatId, T.human(config.businessHours), 'media', now, {
      handoff: { kind: 'Media message', phone, body: `(${data.type || 'media'})` },
    });
  }

  if (state.handoffActive(chatId, now)) return { action: 'human_handling' };

  const { intent, orderNumber } = classify(body);

  if (intent === 'opt_out') {
    state.setOptOut(chatId, true);
    return reply(deps, chatId, T.optOut(), intent, now);
  }
  if (intent === 'opt_in') {
    state.setOptOut(chatId, false);
    return reply(deps, chatId, T.optIn(), intent, now);
  }

  // Details sent right after a bulk enquiry prompt are passed to the team as they are.
  const pending = state.takePending(chatId, now);
  if (pending === 'bulk_details' && intent !== 'human') {
    return reply(deps, chatId, T.bulkThanks(), 'bulk_details', now, {
      handoff: { kind: 'Bulk enquiry details', phone, body },
      startHandoff: true,
    });
  }

  switch (intent) {
    case 'menu':
      return reply(deps, chatId, T.menu(), intent, now);
    case 'order':
      return reply(deps, chatId, T.order(), intent, now);
    case 'bulk':
      state.setPending(chatId, 'bulk_details', BULK_FOLLOWUP_MS, now);
      return reply(deps, chatId, T.bulkAsk(), intent, now, { handoff: { kind: 'Bulk enquiry', phone, body } });
    case 'human':
      return reply(deps, chatId, T.human(config.businessHours), intent, now, {
        handoff: { kind: 'Needs a person', phone, body },
        startHandoff: true,
      });
    case 'tracking':
      return handleTracking({ deps, chatId, phone, body, orderNumber, now });
    default:
      return reply(deps, chatId, T.unknown(), 'unknown', now);
  }
}

async function handleTracking({ deps, chatId, phone, body, orderNumber, now }) {
  const { config } = deps;
  if (!orderNumber) return reply(deps, chatId, T.askOrderNumber(), 'tracking', now);

  if (!config.shopify) {
    return reply(deps, chatId, T.lookupFailed(), 'tracking', now, {
      handoff: { kind: 'Order tracking (lookup off)', phone, body },
      startHandoff: true,
    });
  }
  let result;
  try {
    result = await lookupOrder({
      shopify: config.shopify,
      orderNumber,
      senderPhone: phone,
      fetchImpl: deps.fetchImpl,
    });
  } catch (e) {
    (deps.log || console.error)('[tracking] lookup failed', e.message);
    return reply(deps, chatId, T.lookupFailed(), 'tracking', now, {
      handoff: { kind: 'Order tracking (lookup failed)', phone, body },
      startHandoff: true,
    });
  }
  if (!result.found) return reply(deps, chatId, T.notFound(orderNumber), 'tracking', now);
  if (!result.verified) {
    return reply(deps, chatId, T.unverified(), 'tracking', now, {
      handoff: { kind: `Unverified tracking request for #${orderNumber}`, phone, body },
    });
  }
  return reply(deps, chatId, orderStatus(result.order), 'tracking', now);
}

async function reply(deps, chatId, text, intent, now, opts = {}) {
  const { state, openwa, config } = deps;
  const log = deps.log || (() => {});

  if (!state.allowReply(chatId, config.limits.repliesPerChatPerHour, HOUR, now)) {
    log(`[limit] reply budget reached for ${maskPhone(chatId)}`);
    return { action: 'rate_limited', intent };
  }
  try {
    const sent = await openwa.sendText(chatId, text);
    if (sent && sent.messageId) state.rememberBotMessage(sent.messageId);
  } catch (e) {
    log(`[send] failed for ${maskPhone(chatId)}: ${e.message}`);
    return { action: 'send_failed', intent };
  }
  if (opts.startHandoff) state.startHandoff(chatId, config.limits.handoffHours * HOUR, now);
  if (opts.handoff && config.staffChat) {
    try {
      const note = await openwa.sendText(config.staffChat, staffNote(opts.handoff.kind, `+${opts.handoff.phone || 'unknown'}`, opts.handoff.body));
      if (note && note.messageId) state.rememberBotMessage(note.messageId);
    } catch (e) {
      log(`[staff] notify failed: ${e.message}`);
    }
  }
  log(`[reply] ${intent} -> ${maskPhone(chatId)}`);
  return { action: 'replied', intent };
}

module.exports = { handleEvent, maskPhone };
