'use strict';

// Customer-facing wording. Plain, short, written like a person at the shop.
// Rule for every string here: no em dashes, no robotic filler.

const SITE = 'https://www.nalandaenterprises.com';

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

  order: () =>
    `Happy to help. You can browse and order at ${SITE}, or tell us the product and quantity here ` +
    'and our team will confirm the price and availability. Reply 4 to talk to our team.',

  bulkAsk: () =>
    'Thanks for your bulk or corporate enquiry. Please share in one message:\n' +
    '1) the product(s)\n2) quantity\n3) your company name and city\n4) the date you need delivery by\n' +
    'Our team will send you a quote, usually within one working day.',

  bulkThanks: () =>
    'Thank you, we have noted this. Our team will get back to you here shortly.',

  human: (hours) =>
    'Okay, I have passed this to our team and they will reply here soon.' + (hours ? ` Our hours: ${hours}.` : ''),

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

module.exports = { T, orderStatus, staffNote };
