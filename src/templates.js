'use strict';

// Customer-facing wording. Plain, short, written like a person at the shop.
// Rule for every string here: no em dashes, no robotic filler.

const { summary } = require('./leads');

const SITE = 'https://www.nalandaenterprises.com';
const firstName = (lead) => (lead.name || '').split(' ')[0] || 'there';
const summaryLine = summary;

const T = {
  menu: () =>
    'Hi, thanks for messaging Nalanda Enterprises. How can we help?\n' +
    'Reply with a number:\n' +
    '1  Track my order\n' +
    '2  Place an order or ask about a product\n' +
    '3  Bulk or corporate enquiry\n' +
    '4  Talk to our team',

  askOrderNumber: () => 'Sure, I can check that. Please send your order number, for example #1234.',

  notFound: (n) =>
    `I could not find order #${n}. Please check the number and send it again, or reply 4 to talk to our team.`,

  unverified: () =>
    'For your privacy I can only share order details when you message from the phone number used on the order. ' +
    'Reply 4 and our team will help you.',

  lookupFailed: () =>
    'I could not check that just now. I have passed it to our team and they will reply here soon.',

  orderConfirmed: (name) =>
    `Yes, your order #${String(name).replace(/^#/, '')} is confirmed. Our team will call you once to confirm the details, as we do for every order. Thank you for shopping with us.`,

  shipped: (name, fulfillments) => {
    const lines = [`Good news, your order #${String(name).replace(/^#/, '')} has been shipped.`];
    for (const f of fulfillments || []) {
      for (const t of f.trackingInfo || []) {
        const bits = [];
        if (t.company) bits.push(`Courier: ${t.company}`);
        if (t.number) bits.push(`Tracking ID: ${t.number}`);
        if (bits.length) lines.push(bits.join(', ') + '.');
        if (t.url) lines.push(`Track here: ${t.url}`);
      }
    }
    lines.push('It will reach you in a few days. Reply here if you need any help.');
    return lines.join('\n');
  },

  order: () =>
    `Happy to help. You can browse and order at ${SITE}, or tell us the product and quantity here ` +
    'and our team will confirm the price and availability. Reply 4 to talk to our team.',

  bulkAsk: (contact) =>
    'Thanks for your bulk or wholesale enquiry. Please share in one message:\n' +
    '1) the product(s)\n2) quantity\n3) your company name and city\n4) the date you need delivery by\n' +
    'Our team will call you with a quote.' +
    (contact ? ` You can also reach our wholesale desk directly on ${contact}.` : ''),

  // ---- order cancellation ----
  cancelAskNumber: () => 'I can help with that. Please send the order number you want to cancel, for example #1234.',
  cancelConfirm: (n) =>
    `Order #${n} has not shipped yet, so it can still be cancelled. Reply YES to cancel it, or NO to keep it.`,
  cancelLogged: (n) =>
    `Done, I have sent your cancellation request for order #${n} to our team. They will confirm here, and any refund goes back to the original payment method.`,
  cancelKept: (n) => `Okay, order #${n} stays as it is.`,
  alreadyCancelled: (n) => `Order #${n} is already cancelled.`,
  cannotCancelShipped: (n) =>
    `Order #${n} has already been shipped, so I cannot cancel it here. I have asked our team to help you with a return or refusal at delivery.`,

  // ---- website enquiries ----
  leadHello: (lead, question) =>
    `Hi ${firstName(lead)}, this is Nalanda Enterprises. Thanks for your enquiry${lead.product ? ` about ${lead.product}` : lead.occasion ? ` for ${lead.occasion}` : ''}. ` +
    `To get you the right quote quickly: ${question} (Reply STOP to opt out.)`,
  leadAsk: (step, lead) => {
    if (step === 'item') return 'which item are you looking for, and roughly how many units?';
    if (step === 'qty') return `how many units of ${lead.product || 'it'} do you need?`;
    return 'by what date do you need them? A rough date is fine, or say no fixed date.';
  },
  leadAskAgain: (step, lead) => {
    if (step === 'item') return 'Sorry, which item are you looking for?';
    if (step === 'qty') return 'Sorry, I need a number for the quote, like 50 or 200. How many units do you need?';
    return `And ${T.leadAsk(step, lead)}`;
  },
  leadNext: (step, lead) => {
    const q = T.leadAsk(step, lead);
    return `Thanks. ${q[0].toUpperCase()}${q.slice(1)}`;
  },
  leadKnown: (lead) =>
    `We already have your enquiry (ref ${lead.ref}). Our team will be in touch shortly. If something has changed, just tell us here.`,
  leadDone: (lead, kind) => {
    const first = firstName(lead);
    if (kind === 'closed') return `No problem ${first}, thank you for letting us know. If you need anything later, message us here any time.`;
    if (kind === 'single') {
      return `Thanks ${first}. For one piece the easiest way is to order directly at ${SITE}. If you later need a larger quantity, message us here and we will quote you.`;
    }
    if (kind === 'low') {
      return `Thanks ${first}. For small quantities you can order directly at ${SITE}. If you would still like a quote, our team will message you.`;
    }
    return `Thank you ${first}, we have your enquiry: ${summaryLine(lead)}. Our team will call you ${kind === 'hot' ? 'shortly' : 'within one working day'}.`;
  },

  bulkThanks: () =>
    'Thank you, we have noted this. Our team will get back to you here shortly.',

  human: (hours) =>
    'Okay, I have passed this to our team and they will reply here soon.' + (hours ? ` Our hours: ${hours}.` : ''),

  support: () =>
    'Sorry about that, and thank you for telling us. I have passed this to our support team with your message, ' +
    'and they will reply here soon. If you have your order number or a photo of the problem, please send it here.',

  unknown: () =>
    'Sorry, I did not catch that. Reply 1 to track an order, 2 for orders and products, ' +
    '3 for bulk or corporate enquiries, or 4 to talk to our team.',

  optOut: () =>
    'You are unsubscribed from offers and updates. You will still get replies about your orders. Send START any time to rejoin.',

  optIn: () => 'You are subscribed to offers and updates. Send STOP any time to unsubscribe.',
};

const FULFILLMENT_TEXT = {
  UNFULFILLED: 'is being prepared',
  PARTIALLY_FULFILLED: 'has been partly shipped',
  FULFILLED: 'has been shipped',
  SCHEDULED: 'is scheduled for dispatch',
  ON_HOLD: 'is on hold',
  IN_PROGRESS: 'is being prepared',
  RESTOCKED: 'was returned to stock',
};

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** @param {{name:string,cancelledAt?:string|null,fulfillmentStatus:string,fulfillments:Array}} order */
function orderStatus(order) {
  const n = String(order.name || '').replace(/^#/, '');
  if (order.cancelledAt) return `Order #${n} was cancelled. Reply 4 if you want to talk to our team about it.`;

  const lines = [];
  const status = FULFILLMENT_TEXT[order.fulfillmentStatus] || 'is being processed';
  lines.push(`Order #${n} ${status}.`);

  const delivered = (order.fulfillments || []).find((f) => f.deliveredAt);
  if (delivered) lines.push(`It was delivered on ${formatDate(delivered.deliveredAt) || 'the date shown on the courier site'}.`);

  for (const f of order.fulfillments || []) {
    for (const t of f.trackingInfo || []) {
      const bits = [];
      if (t.company) bits.push(`Courier: ${t.company}`);
      if (t.number) bits.push(`Tracking number: ${t.number}`);
      if (bits.length) lines.push(bits.join(', ') + '.');
      if (t.url) lines.push(`Track here: ${t.url}`);
    }
  }
  return lines.join('\n');
}

function staffNote(kind, phone, body) {
  const text = String(body || '').replace(/\s+/g, ' ').slice(0, 300);
  return `[${kind}] from ${phone}${text ? `: ${text}` : ''}`;
}

function leadNew(lead) {
  const who = `${lead.name || 'No name'}, +${lead.phone}${lead.company ? `, ${lead.company}` : ''}`;
  return (
    `[New lead ${lead.ref}] ${who}. ${lead.product || 'No item given'}${lead.qty ? `, ${lead.qty} units` : ''}. ` +
    `Source: ${lead.source}.${lead.note ? ` Note: ${lead.note}` : ''}`
  );
}

function leadAlert(lead, kind) {
  const label = { hot: 'HOT lead', warm: 'Lead', low: 'Small lead', single: 'Single piece', closed: 'Not interested', stale: 'No reply yet' }[kind] || 'Lead';
  const call = kind === 'hot' ? ' CALL NOW.' : kind === 'warm' || kind === 'stale' ? ' Please call.' : '';
  const who = `${lead.name || 'No name'}, +${lead.phone}${lead.company ? `, ${lead.company}` : ''}`;
  return `[${label} ${lead.ref}] ${who}: ${summary(lead)}.${call}`;
}

module.exports = { T, orderStatus, staffNote, leadNew, leadAlert };
