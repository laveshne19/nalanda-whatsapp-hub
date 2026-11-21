'use strict';
const { T, orderStatus } = require('./templates');

const lead = { ref: 'K7M2QX', name: 'Rahul Sharma', product: 'steel bottles', occasion: 'Diwali / Festive Gifting', qty: 200, when: '5 Dec' };
const lead2 = { ref: 'K7M2QX', name: 'Rahul Sharma', product: '', occasion: 'Diwali / Festive Gifting', qty: null, when: '' };

/** Every message the bot can send a customer, with example values. Written into docs/TEMPLATES.md. */
function sections() {
  return [
    ['Greeting and menu', [
      ['Customer says hi or hello', T.menu()],
    ]],
    ['Order tracking', [
      ['Customer asks for tracking without an order number', T.askOrderNumber()],
      ['Order shipped, with courier and tracking number', orderStatus({ name: '#1234', fulfillmentStatus: 'FULFILLED', fulfillments: [{ trackingInfo: [{ company: 'DTDC', number: '7D141348310', url: 'https://www.dtdc.in/tracking.asp' }] }] })],
      ['Order not shipped yet', orderStatus({ name: '#1234', fulfillmentStatus: 'UNFULFILLED', fulfillments: [] })],
      ['Order delivered', orderStatus({ name: '#1234', fulfillmentStatus: 'FULFILLED', fulfillments: [{ deliveredAt: '2026-11-18T08:00:00Z', trackingInfo: [] }] })],
      ['Order number not found', T.notFound('1234')],
      ['Message is from a different phone than the order (privacy)', T.unverified()],
      ['Shopify could not be checked just now', T.lookupFailed()],
    ]],
    ['Order cancellation', [
      ['Customer wants to cancel, no order number given', T.cancelAskNumber()],
      ['Order has not shipped, ask to confirm', T.cancelConfirm('1234')],
      ['Customer confirmed, request sent to the team', T.cancelLogged('1234')],
      ['Customer said no', T.cancelKept('1234')],
      ['Order was already cancelled', T.alreadyCancelled('1234')],
      ['Order already shipped, cannot cancel here', T.cannotCancelShipped('1234')],
    ]],
    ['Products, support and people', [
      ['Customer asks about ordering or products', T.order()],
      ['Problem with a product, installation, return, warranty', T.support()],
      ['Customer asks for a person, or complaint or refund', T.human('10am to 7pm, Monday to Saturday')],
    ]],
    ['Bulk, wholesale and corporate gifting', [
      ['Bulk or wholesale enquiry', T.bulkAsk('+91 95699 13332')],
      ['After the customer sends the details', T.bulkThanks()],
    ]],
    ['Website enquiries (Get quote form)', [
      ['First message, item not known', T.leadHello(lead2, T.leadAsk('item', lead2))],
      ['First message, item known, asking quantity', T.leadHello(lead, T.leadAsk('qty', lead))],
      ['Asking the date', T.leadNext('when', lead)],
      ['Asking again, quantity not understood', T.leadAskAgain('qty', lead)],
      ['Hot lead, 50 or more units', T.leadDone(lead, 'hot')],
      ['Warm lead, 10 to 49 units', T.leadDone(lead, 'warm')],
      ['Small quantity', T.leadDone(lead, 'low')],
      ['One piece, sent to the website', T.leadDone(lead, 'single')],
      ['Clicked by mistake or not interested', T.leadDone(lead, 'closed')],
      ['Customer messages again about an enquiry already received', T.leadKnown(lead)],
    ]],
    ['Offers on or off', [
      ['Customer sends STOP', T.optOut()],
      ['Customer sends START', T.optIn()],
    ]],
  ];
}

function render() {
  const out = [
    '# Customer message templates',
    '',
    'Every message the bot can send a customer, with example values. This file is generated from',
    '`src/templates.js`. To change wording, edit that file and run `npm run templates`. A test fails if',
    'this file is out of date.',
    '',
    '**House rules for wording:** short, polite, plain language, one question at a time, no em dashes,',
    'no promises about delivery dates, never share order details with a different phone number.',
    '',
    'The bot stays silent on anything it does not clearly understand. Your team answers those.',
    '',
  ];
  for (const [title, items] of sections()) {
    out.push(`## ${title}`, '');
    for (const [when, text] of items) {
      out.push(`**${when}**`, '', ...text.split('\n').map((l) => `> ${l}`.trimEnd()), '');
    }
  }
  return out.join('\n');
}

module.exports = { render };
