'use strict';
const { classify, extractOrderNumber } = require('./intents');
const { T, orderStatus, staffNote, leadNew, leadAlert } = require('./templates');
const { lookupOrder, findRecentOrderByPhone, phoneKey } = require('./shopify');
const leads = require('./leads');
const { buildReport, leadsText } = require('./report');
const { notifyStaff, sendDirect } = require('./notify');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const SHIPPED = new Set(['FULFILLED', 'PARTIALLY_FULFILLED']);
const YES = /^\s*(yes|y|yeah|yep|confirm(ed)?|haan|han|ha)\s*[.!]?\s*$/i;
const NO = /^\s*(no|n|nope|nahi|nahin|keep it)\s*[.!]?\s*$/i;

function senderOf(data) {
  const chatId = data.chatId || data.from;
  const raw = data.senderPhone || (/@c\.us$/.test(chatId || '') ? chatId.split('@')[0] : '');
  return { chatId, phone: phoneKey(raw) ? raw : '' };
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d ? `***${d.slice(-4)}` : 'unknown';
}

// Messages written by machines (brand support tickets, OTPs, courier alerts, bank scams). The bot never answers these.
const AUTOMATED = [
  /^\s*dear\s+(customer|user|sir|madam)\b/i,
  /\bservice\s+ticket\b/i,
  /\b(otp|one[- ]time\s+password)\b/i,
  /\brider\s+has\s+(picked|delivered)\b/i,
  /\b(udgam|rbi)\b/i,
  // Another business pitching its own products to us (suppliers, brands, agencies) is not a customer.
  /\b(we are|we're|this is|i am|i'm)\b[^.\n]{0,60}\b(brand|manufacturer|supplier|agency|company|startup|exporter|vendor)\b/i,
  /\bour\s+(\w+\s+){0,2}(range|collection|catalogue|catalog)\s+(covers|includes|has|offers|consists)\b/i,
];
function looksAutomated(body) {
  const t = String(body || '');
  return t.length > 800 || AUTOMATED.some((re) => re.test(t));
}

const isOwner = (config, phone) =>
  Boolean(config.staffChat && phone && phoneKey(config.staffChat.split('@')[0]) === phoneKey(phone));

/**
 * Handle one verified OpenWA webhook payload. Never throws for bad input.
 * deps: { state, openwa, config, fetchImpl?, log?, now? }
 */
async function handleEvent(payload, deps) {
  const { state, config } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.log || (() => {});
  const data = (payload && payload.data) || {};

  // A person replying from the phone pauses the bot for that chat. Our own messages are told apart
  // by id and by the words we sent, so the bot never mistakes itself for a person.
  if (payload.event === 'message.sent') {
    const chat = data.chatId || data.to;
    const ours = (data.id && state.isBotMessage(data.id)) || state.wasBotText(chat, data.body, now);
    if (config.staffReplyPauses && chat && !data.isGroup && data.kind !== 'group' && !ours) {
      state.startHandoff(chat, config.limits.handoffHours * HOUR, now);
      state.bump('staff_replies', now);
      return { action: 'handoff_by_staff' };
    }
    return { action: 'ignored' };
  }
  if (payload.event !== 'message.received') return { action: 'ignored' };

  if (data.isGroup || data.isStatusBroadcast || data.fromMe || !data.from) return { action: 'ignored' };
  if (payload.idempotencyKey && state.seen(payload.idempotencyKey)) return { action: 'duplicate' };

  const { chatId, phone } = senderOf(data);
  const body = typeof data.body === 'string' ? data.body : '';
  state.bump('in', now);
  state.noteChat(chatId, now);

  // The owner can ask the bot for numbers. Anything else the owner types is handled like a customer message.
  if (isOwner(config, phone)) {
    const out = await ownerCommand(body, deps, chatId, now);
    if (out) return out;
  }

  if (looksAutomated(body)) {
    state.bump('automated', now);
    return { action: 'ignored_automated' };
  }

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

  const pending = state.peekPending(chatId, now);
  if (pending) {
    const r = await continuePending({ deps, pending, chatId, phone, body, intent, now });
    if (r) return r;
  }

  // Website enquiry in progress, or the customer arrived by tapping the website chat button.
  const ref = leads.findRef(body);
  if (ref) {
    const lead = state.getLead(ref);
    if (lead) return handleLeadArrival({ deps, lead, chatId, now });
  }
  if (!ref && /\b(enquir|inquir|quote|quotation|requested)/i.test(body)) {
    const lead = state.unstartedLeadFor(phoneKey(phone), now);
    if (lead) return handleLeadArrival({ deps, lead, chatId, now });
  }
  if (!['tracking', 'cancel', 'human'].includes(intent)) {
    const lead = state.collectingLeadFor(chatId, phoneKey(phone));
    if (lead) return handleLeadReply({ deps, lead, chatId, body, intent, now });
  }

  switch (intent) {
    case 'menu':
      return reply(deps, chatId, T.menu(), intent, now);
    case 'order':
      return reply(deps, chatId, T.order(), intent, now);
    case 'bulk':
      state.setPending(chatId, 'bulk_details', 24 * HOUR, now);
      state.bump('bulk', now);
      return reply(deps, chatId, T.bulkAsk(config.wholesaleContact), intent, now, {
        handoff: { kind: 'Bulk or wholesale enquiry', phone, body },
      });
    case 'human':
      return reply(deps, chatId, T.human(config.businessHours), intent, now, {
        handoff: { kind: 'Needs a person', phone, body },
        startHandoff: true,
      });
    case 'support':
      return reply(deps, chatId, T.support(), intent, now, {
        handoff: { kind: 'Support or return request', phone, body },
        startHandoff: true,
      });
    case 'cancel':
      return handleCancel({ deps, chatId, phone, body, orderNumber, now });
    case 'order_status':
      return handleOrderStatus({ deps, chatId, phone, body, orderNumber, now });
    case 'tracking':
      return handleTracking({ deps, chatId, phone, body, orderNumber, now });
    default:
      // Not understood: say nothing. This number is also used for suppliers, dealers and staff chats,
      // so a guess would be worse than silence. The daily report counts these for your team.
      state.bump('silent', now);
      return { action: 'silent' };
  }
}

// ---------------------------------------------------------------- owner commands

async function ownerCommand(body, deps, chatId, now) {
  const { state, config } = deps;
  const t = body.trim().toLowerCase();
  let text = null;
  if (t === 'report') text = buildReport(state, config, now);
  else if (t === 'leads') text = leadsText(state);
  else {
    const m = /^done\s+([a-z0-9]{6})$/.exec(t);
    if (m) {
      const lead = state.getLead(m[1].toUpperCase());
      if (lead) {
        lead.status = 'done';
        lead.completed = true;
        state.saveLead(lead);
        text = `Marked ${lead.ref} as done.`;
      } else {
        text = `I could not find ${m[1].toUpperCase()}.`;
      }
    }
  }
  if (text == null) return null;
  await sendDirect(deps, chatId, text);
  return { action: 'owner_command' };
}

// ---------------------------------------------------------------- pending answers

async function continuePending({ deps, pending, chatId, phone, body, intent, now }) {
  const { state } = deps;

  if (pending.kind === 'bulk_details') {
    if (intent === 'human') return null;
    state.clearPending(chatId);
    return reply(deps, chatId, T.bulkThanks(), 'bulk_details', now, {
      handoff: { kind: 'Bulk enquiry details', phone, body },
      startHandoff: true,
    });
  }

  if (pending.kind === 'cancel_ask_number') {
    state.clearPending(chatId);
    const n = extractOrderNumber(body);
    if (!n || ['human', 'opt_out'].includes(intent)) return null;
    return handleCancel({ deps, chatId, phone, body, orderNumber: n, now });
  }

  if (pending.kind === 'cancel_confirm') {
    const n = pending.meta && pending.meta.orderNumber;
    if (YES.test(body)) {
      state.clearPending(chatId);
      state.bump('cancel_requests', now);
      const fin = (pending.meta && pending.meta.financialStatus) || 'payment status unknown';
      return reply(deps, chatId, T.cancelLogged(n), 'cancel_confirmed', now, {
        handoff: { kind: `Cancellation request for #${n} (${fin})`, phone, body: 'Customer confirmed. Please cancel and refund in Shopify.' },
      });
    }
    if (NO.test(body)) {
      state.clearPending(chatId);
      return reply(deps, chatId, T.cancelKept(n), 'cancel_kept', now);
    }
    state.clearPending(chatId); // something else was said, treat it as a fresh message
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- tracking and cancellation

async function lookup({ deps, orderNumber, phone }) {
  return lookupOrder({
    shopify: deps.config.shopify,
    orderNumber,
    senderPhone: phone,
    fetchImpl: deps.fetchImpl,
  });
}

async function handleTracking({ deps, chatId, phone, body, orderNumber, now }) {
  const { config, state } = deps;
  if (!orderNumber) return reply(deps, chatId, T.askOrderNumber(), 'tracking', now);

  if (!config.shopify) {
    return reply(deps, chatId, T.lookupFailed(), 'tracking', now, {
      handoff: { kind: 'Order tracking (lookup off)', phone, body },
      startHandoff: true,
    });
  }
  let result;
  try {
    result = await lookup({ deps, orderNumber, phone });
  } catch (e) {
    (deps.log || console.error)('[tracking] lookup failed', e.message);
    return reply(deps, chatId, T.lookupFailed(), 'tracking', now, {
      handoff: { kind: 'Order tracking (lookup failed)', phone, body },
      startHandoff: true,
    });
  }
  if (!result.found) return reply(deps, chatId, T.notFound(orderNumber), 'tracking', now);
  if (!result.verified) {
    state.bump('tracking_unverified', now);
    return reply(deps, chatId, T.unverified(), 'tracking', now, {
      handoff: { kind: `Unverified tracking request for #${orderNumber}`, phone, body },
    });
  }
  state.bump('tracking_answered', now);
  return reply(deps, chatId, orderStatus(result.order), 'tracking', now);
}

// "Is my order confirmed?" Answer only when the order is really in Shopify under the sender's own phone.
async function handleOrderStatus({ deps, chatId, phone, body, orderNumber, now }) {
  const { config, state } = deps;
  if (orderNumber) return handleTracking({ deps, chatId, phone, body, orderNumber, now });
  const handOff = (kind) =>
    reply(deps, chatId, T.lookupFailed(), 'order_status', now, { handoff: { kind, phone, body }, startHandoff: true });
  if (!config.shopify) return handOff('Order confirmation question (lookup off)');
  let result;
  try {
    result = await findRecentOrderByPhone({ shopify: config.shopify, senderPhone: phone, fetchImpl: deps.fetchImpl, now: () => now });
  } catch (e) {
    (deps.log || console.error)('[order_status] lookup failed', e.message);
    return handOff('Order confirmation question (lookup failed)');
  }
  if (!result.found) return reply(deps, chatId, T.askOrderNumber(), 'order_status', now);
  const o = result.order;
  state.bump('tracking_answered', now);
  if (o.cancelledAt || SHIPPED.has(o.fulfillmentStatus)) return reply(deps, chatId, orderStatus(o), 'order_status', now);
  return reply(deps, chatId, T.orderConfirmed(o.name), 'order_status', now);
}

async function handleCancel({ deps, chatId, phone, body, orderNumber, now }) {
  const { config, state } = deps;
  if (!orderNumber) {
    state.setPending(chatId, 'cancel_ask_number', 15 * MIN, now);
    return reply(deps, chatId, T.cancelAskNumber(), 'cancel', now);
  }
  if (!config.shopify) {
    return reply(deps, chatId, T.lookupFailed(), 'cancel', now, {
      handoff: { kind: `Cancellation request for #${orderNumber} (lookup off)`, phone, body },
      startHandoff: true,
    });
  }
  let result;
  try {
    result = await lookup({ deps, orderNumber, phone });
  } catch (e) {
    (deps.log || console.error)('[cancel] lookup failed', e.message);
    return reply(deps, chatId, T.lookupFailed(), 'cancel', now, {
      handoff: { kind: `Cancellation request for #${orderNumber} (lookup failed)`, phone, body },
      startHandoff: true,
    });
  }
  if (!result.found) return reply(deps, chatId, T.notFound(orderNumber), 'cancel', now);
  if (!result.verified) {
    state.bump('tracking_unverified', now);
    return reply(deps, chatId, T.unverified(), 'cancel', now, {
      handoff: { kind: `Unverified cancellation request for #${orderNumber}`, phone, body },
    });
  }
  const order = result.order;
  if (order.cancelledAt) return reply(deps, chatId, T.alreadyCancelled(orderNumber), 'cancel', now);
  if (SHIPPED.has(order.fulfillmentStatus)) {
    return reply(deps, chatId, T.cannotCancelShipped(orderNumber), 'cancel', now, {
      handoff: { kind: `Cancellation request for #${orderNumber}, already shipped`, phone, body },
      startHandoff: true,
    });
  }
  state.setPending(chatId, 'cancel_confirm', 30 * MIN, now, {
    orderNumber,
    financialStatus: order.financialStatus || null,
  });
  return reply(deps, chatId, T.cancelConfirm(orderNumber), 'cancel', now);
}

// ---------------------------------------------------------------- website enquiries

async function finalizeLead(deps, lead, chatId, now) {
  const kind = leads.grade(lead);
  lead.completed = true;
  lead.status = kind === 'hot' || kind === 'warm' ? 'needs_call' : kind;
  deps.state.saveLead(lead);
  deps.state.bump(`lead_${kind}`, now);
  return reply(deps, chatId, T.leadDone(lead, kind), `lead_${kind}`, now, { staffText: leadAlert(lead, kind) });
}

/** The customer tapped the website chat button, so their first message carries the enquiry ref. */
async function handleLeadArrival({ deps, lead, chatId, now }) {
  const { state } = deps;
  if (lead.completed) return reply(deps, chatId, T.leadKnown(lead), 'lead_known', now);
  lead.chatId = chatId;
  lead.lastActivity = now;
  const first = !lead.started;
  lead.started = true;
  state.saveLead(lead);
  if (lead.step === 'done') return finalizeLead(deps, lead, chatId, now);
  const text = first ? T.leadHello(lead, T.leadAsk(lead.step, lead)) : T.leadNext(lead.step, lead);
  return reply(deps, chatId, text, 'lead_question', now);
}

async function handleLeadReply({ deps, lead, chatId, body, intent, now }) {
  // a plain "hi" is not an answer, just ask the current question again
  if (intent === 'menu') return reply(deps, chatId, T.leadNext(lead.step, lead), 'lead_question', now);
  const before = lead.step;
  leads.applyAnswer(lead, body, now);
  deps.state.saveLead(lead);
  if (lead.step === 'done') return finalizeLead(deps, lead, chatId, now);
  const text = lead.step === before ? T.leadAskAgain(lead.step, lead) : T.leadNext(lead.step, lead);
  return reply(deps, chatId, text, 'lead_question', now);
}

/**
 * A new enquiry from the website form (server to server, already signature checked).
 * Starts the chat on WhatsApp when allowed, and always makes sure a person hears about it.
 */
async function intakeLead(input, deps) {
  const { state, config } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.log || (() => {});

  const phone = leads.normalizePhone(input && input.phone);
  if (!phone) return { ok: false, status: 400, error: 'invalid phone' };

  const dup = state.recentLeadByPhone(phone, now);
  if (dup) return { ok: true, ref: dup.ref, duplicate: true };
  if (!state.allowIntake(config.leads.intakePerHour, now)) return { ok: false, status: 429, error: 'too many submissions' };

  const lead = leads.createLead(input, now);
  state.saveLead(lead);
  state.bump('lead_new', now);

  let started = false;
  if (config.leads.proactive && state.allowProactive(config.leads.proactivePerDay, now)) {
    try {
      const text = lead.step === 'done' ? T.leadDone(lead, leads.grade(lead)) : T.leadHello(lead, T.leadAsk(lead.step, lead));
      state.rememberBotText(lead.chatId, text, now);
      const sent = await deps.openwa.sendText(lead.chatId, text);
      if (sent && sent.messageId) state.rememberBotMessage(sent.messageId);
      started = true;
      lead.started = true;
    } catch (e) {
      log(`[lead] WhatsApp send failed for ${maskPhone(lead.phone)}: ${e.message}`);
      state.bump('send_failed', now);
    }
  }

  if (lead.step === 'done') {
    const kind = leads.grade(lead);
    lead.completed = true;
    lead.status = kind === 'hot' || kind === 'warm' ? 'needs_call' : kind;
    state.bump(`lead_${kind}`, now);
    state.saveLead(lead);
    await notifyStaff(deps, leadAlert(lead, kind));
  } else if (!started) {
    lead.status = 'needs_call';
    state.saveLead(lead);
    await notifyStaff(deps, `${leadNew(lead)} I could not message them on WhatsApp, please call.`);
  } else {
    state.saveLead(lead);
    if (config.leads.notifyOnCreate) await notifyStaff(deps, leadNew(lead));
  }
  return { ok: true, ref: lead.ref, whatsapp: started };
}

// ---------------------------------------------------------------- sending

async function reply(deps, chatId, text, intent, now, opts = {}) {
  const { state, openwa, config } = deps;
  const log = deps.log || (() => {});

  if (!state.allowReply(chatId, config.limits.repliesPerChatPerHour, HOUR, now)) {
    log(`[limit] reply budget reached for ${maskPhone(chatId)}`);
    state.bump('rate_limited', now);
    return { action: 'rate_limited', intent };
  }
  try {
    state.rememberBotText(chatId, text, now);
    const sent = await openwa.sendText(chatId, text);
    if (sent && sent.messageId) state.rememberBotMessage(sent.messageId);
  } catch (e) {
    log(`[send] failed for ${maskPhone(chatId)}: ${e.message}`);
    state.bump('send_failed', now);
    return { action: 'send_failed', intent };
  }
  state.bump('replied', now);
  if (opts.startHandoff) state.startHandoff(chatId, config.limits.handoffHours * HOUR, now);
  if (opts.handoff || opts.startHandoff) state.bump('handoff', now);
  if (opts.staffText) {
    await notifyStaff(deps, opts.staffText);
  } else if (opts.handoff) {
    await notifyStaff(deps, staffNote(opts.handoff.kind, `+${opts.handoff.phone || 'unknown'}`, opts.handoff.body));
  }
  log(`[reply] ${intent} -> ${maskPhone(chatId)}`);
  return { action: 'replied', intent };
}

module.exports = { handleEvent, intakeLead, maskPhone };
