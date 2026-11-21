'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleEvent, intakeLead } = require('../src/handler');
const { State } = require('../src/state');
const { maybeSendDailyReport, sweepLeads, buildReport } = require('../src/report');
const { istDate } = require('../src/util');

const OWNER = '919569913332@c.us';
const CUSTOMER = '919876543210@c.us';
const T0 = Date.UTC(2026, 10, 21, 5, 0, 0); // 10:30 IST on 21 Nov 2026

function setup(over = {}) {
  const sent = [];
  let n = 0;
  const openwa = { sendText: async (chatId, text) => { if (over.failSend) throw new Error('down'); sent.push({ chatId, text }); return { messageId: `B${++n}` }; } };
  const config = {
    shopify: { domain: 's.example.com', token: 't', apiVersion: '2026-10' },
    staffChat: OWNER,
    wholesaleContact: '+91 95699 13332',
    businessHours: '10am to 7pm',
    reportHourIst: 20,
    staffReplyPauses: false,
    limits: { repliesPerChatPerHour: 10, handoffHours: 12 },
    leads: { secret: 's', proactive: true, notifyOnCreate: true, proactivePerDay: 30, intakePerHour: 60, staleMinutes: 30 },
    ...over.config,
  };
  const orderNode = {
    name: '#1234', createdAt: 'x', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', displayFinancialStatus: 'PAID',
    phone: null, customer: { defaultPhoneNumber: { phoneNumber: '+91 98765 43210' } }, shippingAddress: null, billingAddress: null,
    fulfillments: [], ...over.order,
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { orders: { edges: [{ node: orderNode }] } } }) });
  const state = new State(null);
  let clock = T0;
  const deps = { state, openwa, config, fetchImpl, log: () => {}, now: () => clock };
  return { deps, sent, state, tick: (ms) => { clock += ms; }, setClock: (t) => { clock = t; } };
}

let k = 0;
const msg = (body, extra = {}) => ({
  event: 'message.received', idempotencyKey: `f-${++k}`,
  data: { id: `m${k}`, from: CUSTOMER, body, type: 'chat', isGroup: false, ...extra },
});
const to = (sent, chat) => sent.filter((s) => s.chatId === chat);

// ------------------------------------------------------------ wholesale routing

test('wholesale enquiry: customer gets the wholesale number, owner gets the alert', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('I need wholesale rates for power banks'), deps);
  assert.match(to(sent, CUSTOMER)[0].text, /wholesale desk directly on \+91 95699 13332/);
  assert.match(to(sent, OWNER)[0].text, /^\[Bulk or wholesale enquiry\] from \+919876543210/);
});

// ------------------------------------------------------------ cancellation

test('cancel: unshipped order, verified customer, confirm with YES, owner is asked to cancel', async () => {
  const { deps, sent, state } = setup();
  await handleEvent(msg('please cancel order #1234'), deps);
  assert.match(to(sent, CUSTOMER)[0].text, /has not shipped yet.*Reply YES/);
  await handleEvent(msg('yes'), deps);
  assert.match(to(sent, CUSTOMER)[1].text, /sent your cancellation request for order #1234/);
  assert.match(to(sent, OWNER)[0].text, /Cancellation request for #1234 \(PAID\)/);
  assert.equal(state.statsFor(istDate(T0)).cancel_requests, 1);
});

test('cancel: NO keeps the order and tells nobody', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('cancel order #1234'), deps);
  await handleEvent(msg('no'), deps);
  assert.match(to(sent, CUSTOMER)[1].text, /stays as it is/);
  assert.equal(to(sent, OWNER).length, 0);
});

test('cancel: an unrelated message after the prompt is handled normally and clears the question', async () => {
  const { deps, sent, state } = setup();
  await handleEvent(msg('cancel order #1234'), deps);
  await handleEvent(msg('hi'), deps);
  assert.match(to(sent, CUSTOMER)[1].text, /Track my order/);
  assert.equal(state.peekPending(CUSTOMER, T0), null);
});

test('cancel: shipped order cannot be cancelled here, owner is told', async () => {
  const { deps, sent, state } = setup({ order: { displayFulfillmentStatus: 'FULFILLED' } });
  await handleEvent(msg('cancel #1234'), deps);
  assert.match(to(sent, CUSTOMER)[0].text, /already been shipped/);
  assert.match(to(sent, OWNER)[0].text, /already shipped/);
  assert.equal(state.handoffActive(CUSTOMER, T0), true);
});

test('cancel: already cancelled order is reported as such', async () => {
  const { deps, sent } = setup({ order: { cancelledAt: '2026-11-01T00:00:00Z' } });
  await handleEvent(msg('cancel #1234'), deps);
  assert.match(to(sent, CUSTOMER)[0].text, /already cancelled/);
});

test('cancel: wrong phone gets nothing about the order and no confirm prompt', async () => {
  const { deps, sent, state } = setup();
  await handleEvent(msg('cancel #1234', { from: '918000000000@c.us' }), deps);
  assert.match(to(sent, '918000000000@c.us')[0].text, /privacy/);
  assert.equal(state.peekPending('918000000000@c.us', T0), null);
  assert.match(to(sent, OWNER)[0].text, /Unverified cancellation request for #1234/);
});

test('cancel: without an order number the bot asks, then continues with the number', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('I want to cancel'), deps);
  assert.match(to(sent, CUSTOMER)[0].text, /send the order number you want to cancel/);
  await handleEvent(msg('#1234'), deps);
  assert.match(to(sent, CUSTOMER)[1].text, /Reply YES/);
});

// ------------------------------------------------------------ owner commands

test('owner can ask for the report and the lead list; others cannot', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('hi'), deps);
  await handleEvent(msg('report', { from: OWNER }), deps);
  const ownerMsgs = to(sent, OWNER);
  assert.match(ownerMsgs[0].text, /^Nalanda WhatsApp report/);
  assert.match(ownerMsgs[0].text, /Chats today: 2/);
  await handleEvent(msg('leads', { from: OWNER }), deps);
  assert.match(to(sent, OWNER)[1].text, /No leads waiting for a call/);

  const before = sent.length;
  await handleEvent(msg('report', { from: '918000000000@c.us' }), deps);
  assert.ok(!/Nalanda WhatsApp report/.test(sent.slice(before).map((s) => s.text).join('')));
});

test('owner can also be recognised through the resolved phone number (lid senders)', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('report', { from: '12345@lid', senderPhone: '919569913332' }), deps);
  assert.match(sent[0].text, /^Nalanda WhatsApp report/);
});

test('owner normal messages are handled like a customer, only exact commands are special', async () => {
  const { deps, sent } = setup();
  await handleEvent(msg('hi', { from: OWNER }), deps);
  assert.match(sent[0].text, /Track my order/);
});

// ------------------------------------------------------------ website leads

const form = (over = {}) => ({ name: 'Asha Rao', phone: '98765 43211', company: 'ABC Traders', source: 'corporate-gifting-india', ...over });
const LEAD_CHAT = '919876543211@c.us';

test('lead: bot starts the chat, qualifies, and the owner gets a HOT lead alert', async () => {
  const { deps, sent, state } = setup();
  const out = await intakeLead(form(), deps);
  assert.equal(out.ok, true);
  assert.equal(out.whatsapp, true);
  assert.match(to(sent, LEAD_CHAT)[0].text, /Hi Asha, this is Nalanda Enterprises.*which item are you looking for/s);
  assert.match(to(sent, OWNER)[0].text, new RegExp(`^\\[New lead ${out.ref}\\]`));

  await handleEvent(msg('steel bottles, 200 pcs', { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT)[1].text, /by what date/i);
  await handleEvent(msg('by 5 Dec with our logo', { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT)[2].text, /Our team will call you shortly/);
  assert.match(to(sent, OWNER)[1].text, new RegExp(`^\\[HOT lead ${out.ref}\\].*200 units.*CALL NOW`));
  assert.equal(state.getLead(out.ref).status, 'needs_call');
});

test('lead: someone who clicked by mistake is closed without bothering the sales team', async () => {
  const { deps, sent, state } = setup();
  const out = await intakeLead(form(), deps);
  await handleEvent(msg('sorry clicked by mistake', { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT)[1].text, /No problem Asha/);
  assert.match(to(sent, OWNER)[1].text, /Not interested/);
  assert.ok(!/CALL/.test(to(sent, OWNER)[1].text));
  assert.equal(state.getLead(out.ref).status, 'closed');
});

test('lead: one piece buyer is sent to the website', async () => {
  const { deps, sent } = setup();
  await intakeLead(form({ product: 'Air fryer' }), deps);
  await handleEvent(msg('only one piece', { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT)[1].text, /order directly at https:\/\/www\.nalandaenterprises\.com/);
  assert.match(to(sent, OWNER)[1].text, /Single piece/);
});

test('lead: complete form is graded immediately and confirmed', async () => {
  const { deps, sent } = setup();
  const out = await intakeLead(form({ product: 'Lunch boxes', quantity: '80', when: '15 Dec' }), deps);
  assert.match(to(sent, LEAD_CHAT)[0].text, /we have your enquiry: Lunch boxes, 80 units/);
  assert.match(to(sent, OWNER)[0].text, new RegExp(`^\\[HOT lead ${out.ref}\\]`));
});

test('lead: when WhatsApp is switched off the owner is told to call', async () => {
  const { deps, sent, state } = setup({ config: { leads: { secret: 's', proactive: false, notifyOnCreate: true, proactivePerDay: 30, intakePerHour: 60, staleMinutes: 30 } } });
  const out = await intakeLead(form(), deps);
  assert.equal(out.whatsapp, false);
  assert.equal(to(sent, LEAD_CHAT).length, 0);
  assert.match(to(sent, OWNER)[0].text, /could not message them on WhatsApp, please call/);
  assert.equal(state.getLead(out.ref).status, 'needs_call');
});

test('lead: WhatsApp send failure still reaches the owner', async () => {
  const sent = [];
  const { deps } = setup();
  let call = 0;
  deps.openwa = { sendText: async (c, t) => { call++; if (c === LEAD_CHAT) throw new Error('429'); sent.push({ chatId: c, text: t }); return { messageId: `X${call}` }; } };
  const out = await intakeLead(form(), deps);
  assert.equal(out.whatsapp, false);
  assert.match(sent[0].text, /please call/);
});

test('lead: website button path, customer arrives with the ref code', async () => {
  const { deps, sent } = setup({ config: { leads: { secret: 's', proactive: false, notifyOnCreate: false, proactivePerDay: 30, intakePerHour: 60, staleMinutes: 30 } } });
  const out = await intakeLead(form(), deps);
  await handleEvent(msg(`Hi, I just requested a quote (ref ${out.ref})`, { from: '5555@lid', senderPhone: '919876543211' }), deps);
  assert.match(to(sent, '5555@lid')[0].text, /which item are you looking for/);
  await handleEvent(msg('power banks 100 pcs', { from: '5555@lid', senderPhone: '919876543211' }), deps);
  assert.match(to(sent, '5555@lid')[1].text, /by what date/i);
});

test('lead: ref of a finished enquiry just says we have it', async () => {
  const { deps, sent } = setup();
  const out = await intakeLead(form({ product: 'Mugs', quantity: '500', when: 'Dec' }), deps);
  await handleEvent(msg(`ref ${out.ref}`, { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT).pop().text, /We already have your enquiry/);
});

test('lead: tracking questions are still answered while an enquiry is open', async () => {
  const { deps, sent } = setup();
  await intakeLead(form({ phone: '9876543210' }), deps);
  await handleEvent(msg('where is my order #1234'), deps);
  assert.match(to(sent, CUSTOMER).pop().text, /Order #1234/);
});

test('lead: same phone submitting twice in a day is one lead', async () => {
  const { deps, sent } = setup();
  const a = await intakeLead(form(), deps);
  const b = await intakeLead(form(), deps);
  assert.equal(b.duplicate, true);
  assert.equal(a.ref, b.ref);
  assert.equal(to(sent, LEAD_CHAT).length, 1);
});

test('lead: invalid phone is refused, too many submissions are throttled', async () => {
  const { deps } = setup({ config: { leads: { secret: 's', proactive: false, notifyOnCreate: false, proactivePerDay: 30, intakePerHour: 2, staleMinutes: 30 } } });
  assert.equal((await intakeLead(form({ phone: '123' }), deps)).status, 400);
  assert.equal((await intakeLead(form({ phone: '9000000001' }), deps)).ok, true);
  assert.equal((await intakeLead(form({ phone: '9000000002' }), deps)).ok, true);
  assert.equal((await intakeLead(form({ phone: '9000000003' }), deps)).status, 429);
});

test('lead: the bot only starts a limited number of chats per day by itself', async () => {
  const { deps, sent } = setup({ config: { leads: { secret: 's', proactive: true, notifyOnCreate: false, proactivePerDay: 1, intakePerHour: 60, staleMinutes: 30 } } });
  await intakeLead(form({ phone: '9000000001' }), deps);
  const second = await intakeLead(form({ phone: '9000000002' }), deps);
  assert.equal(second.whatsapp, false);
  assert.equal(to(sent, '919000000002@c.us').length, 0);
  assert.match(to(sent, OWNER).pop().text, /please call/);
});

// ------------------------------------------------------------ sweep and report

test('sweep: a lead that never answers is handed to the owner once the wait is over', async () => {
  const { deps, sent, state, tick } = setup();
  const out = await intakeLead(form(), deps);
  const before = to(sent, OWNER).length;
  tick(10 * 60 * 1000);
  assert.equal(await sweepLeads(deps), 0);
  tick(25 * 60 * 1000);
  assert.equal(await sweepLeads(deps), 1);
  assert.match(to(sent, OWNER)[before].text, new RegExp(`^\\[No reply yet ${out.ref}\\].*Please call`));
  assert.equal(state.getLead(out.ref).status, 'needs_call');
  tick(60 * 1000);
  assert.equal(await sweepLeads(deps), 0); // only once
});

test('sweep: a late answer still continues the enquiry', async () => {
  const { deps, sent, tick } = setup();
  const out = await intakeLead(form(), deps);
  tick(40 * 60 * 1000);
  await sweepLeads(deps);
  await handleEvent(msg('mugs 300 pcs', { from: LEAD_CHAT }), deps);
  assert.match(to(sent, LEAD_CHAT).pop().text, /by what date/i);
  assert.ok(out.ref);
});

test('sweep: a failing alert is retried only a few times', async () => {
  const { deps, tick } = setup({ failSend: true, config: { leads: { secret: 's', proactive: false, notifyOnCreate: false, proactivePerDay: 30, intakePerHour: 60, staleMinutes: 30 } } });
  await intakeLead(form(), deps);
  let attempts = 0;
  deps.openwa = { sendText: async () => { attempts++; throw new Error('down'); } };
  for (let i = 0; i < 30; i++) { tick(11 * 60 * 1000); await sweepLeads(deps); }
  assert.ok(attempts <= 3, `attempts=${attempts}`);
});

test('report: sent once a day after the report hour, not before', async () => {
  const { deps, sent, setClock } = setup();
  await handleEvent(msg('hi'), deps);
  const evening = Date.UTC(2026, 10, 21, 14, 45, 0); // 20:15 IST
  setClock(Date.UTC(2026, 10, 21, 9, 0, 0)); // 14:30 IST
  assert.equal(await maybeSendDailyReport(deps), false);
  setClock(evening);
  assert.equal(await maybeSendDailyReport(deps), true);
  assert.match(to(sent, OWNER).pop().text, /^Nalanda WhatsApp report, 21 Nov 2026/);
  setClock(evening + 30 * 60 * 1000);
  assert.equal(await maybeSendDailyReport(deps), false);
});

test('report: a failing send is tried at most 3 times a day', async () => {
  const { deps, setClock } = setup();
  let attempts = 0;
  deps.openwa = { sendText: async () => { attempts++; throw new Error('down'); } };
  let t = Date.UTC(2026, 10, 21, 14, 45, 0);
  for (let i = 0; i < 20; i++) { t += 11 * 60 * 1000; setClock(t); await maybeSendDailyReport(deps); }
  assert.equal(attempts, 3);
});

test('report: counts line up with what happened', async () => {
  const { deps, state } = setup();
  await handleEvent(msg('where is my order #1234'), deps);
  await handleEvent(msg('track #1234', { from: '918000000000@c.us' }), deps);
  await handleEvent(msg('bulk order 500 pcs', { from: '917000000000@c.us' }), deps);
  const text = buildReport(state, deps.config, T0);
  assert.match(text, /Chats today: 3/);
  assert.match(text, /Order tracking: 1 answered, 1 not verified/);
  assert.match(text, /Bulk and wholesale enquiries: 1/);
});

test('owner can mark a lead as done and it leaves the call list', async () => {
  const { deps, sent } = setup({ config: { leads: { secret: 's', proactive: false, notifyOnCreate: false, proactivePerDay: 30, intakePerHour: 60, staleMinutes: 30 } } });
  const out = await intakeLead(form(), deps);
  await handleEvent(msg('leads', { from: OWNER }), deps);
  assert.match(to(sent, OWNER).pop().text, new RegExp(`Leads to call \\(1\\):\\n${out.ref} Asha Rao`));
  await handleEvent(msg(`done ${out.ref.toLowerCase()}`, { from: OWNER }), deps);
  assert.match(to(sent, OWNER).pop().text, new RegExp(`Marked ${out.ref} as done`));
  await handleEvent(msg('leads', { from: OWNER }), deps);
  assert.match(to(sent, OWNER).pop().text, /No leads waiting/);
});
