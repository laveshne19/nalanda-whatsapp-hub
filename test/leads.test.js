'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/leads');

test('phone numbers are normalised to 91XXXXXXXXXX', () => {
  assert.equal(L.normalizePhone('98765 43210'), '919876543210');
  assert.equal(L.normalizePhone('+91-98765-43210'), '919876543210');
  assert.equal(L.normalizePhone('09876543210'), '919876543210');
  assert.equal(L.normalizePhone('919876543210'), '919876543210');
  assert.equal(L.normalizePhone('12345'), '');
  assert.equal(L.normalizePhone(''), '');
  assert.equal(L.normalizePhone(null), '');
  assert.equal(L.normalizePhone('5551234567'), ''); // not a valid Indian mobile, too short for international
});

test('reference codes are 6 characters without look-alikes and can be found in text', () => {
  for (let i = 0; i < 50; i++) assert.match(L.makeRef(), /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(L.findRef('Hi, I just requested a quote (ref K7M2QX)'), 'K7M2QX');
  assert.equal(L.findRef('reference: k7m2qx'), 'K7M2QX');
  assert.equal(L.findRef('hello there'), null);
});

test('quantities are read from natural phrases', () => {
  assert.equal(L.parseQty('need 500 pcs with logo'), 500);
  assert.equal(L.parseQty('1,200 units'), 1200);
  assert.equal(L.parseQty('qty: 75'), 75);
  assert.equal(L.parseQty('only one piece'), 1);
  assert.equal(L.parseQty('just one'), 1);
  assert.equal(L.parseQty('gift sets for diwali 2026'), null); // a year is not a quantity
  assert.equal(L.parseQty('200', { loose: true }), 200);
  assert.equal(L.parseQty('around 300 or so', { loose: true }), 300);
  assert.equal(L.parseQty('9876543210', { loose: true }), null); // a phone number is not a quantity
});

test('form with everything filled is already complete', () => {
  const lead = L.createLead({ name: 'Asha Rao', phone: '9876543210', product: 'Borosil lunch box', quantity: '120', when: '10 Dec' }, 1000);
  assert.equal(lead.step, 'done');
  assert.equal(L.grade(lead), 'hot');
});

test('form with only a product asks for quantity next', () => {
  const lead = L.createLead({ name: 'Asha', phone: '9876543210', product: 'Water bottles' }, 1000);
  assert.equal(lead.step, 'qty');
  assert.equal(lead.chatId, '919876543210@c.us');
});

test('empty form asks for the item first', () => {
  const lead = L.createLead({ name: 'Asha', phone: '9876543210' }, 1000);
  assert.equal(lead.step, 'item');
});

test('conversation: item with quantity, then date, then done and graded', () => {
  const lead = L.createLead({ name: 'Asha', phone: '9876543210' }, 1000);
  L.applyAnswer(lead, 'steel bottles, 200 pcs', 2000);
  assert.equal(lead.qty, 200);
  assert.match(lead.product, /steel bottles/);
  assert.equal(lead.step, 'when');
  L.applyAnswer(lead, 'by 5 Dec', 3000);
  assert.equal(lead.step, 'done');
  assert.equal(L.grade(lead), 'hot');
});

test('a year in the item answer is not taken as quantity', () => {
  const lead = L.createLead({ name: 'A', phone: '9876543210' }, 1);
  L.applyAnswer(lead, 'diwali gift sets 2026');
  assert.equal(lead.qty, null);
  assert.equal(lead.step, 'qty');
});

test('quantity is asked again once, then given up on so we do not nag', () => {
  const lead = L.createLead({ name: 'A', phone: '9876543210', product: 'Mugs' }, 1);
  L.applyAnswer(lead, 'not sure');
  assert.equal(lead.step, 'qty');
  L.applyAnswer(lead, 'depends on price');
  assert.equal(lead.step, 'when');
  assert.equal(lead.qtyNote, 'depends on price');
  assert.equal(L.grade(lead), 'warm'); // unknown quantity goes to a person
});

test('single piece buyers are routed away from the sales team', () => {
  const lead = L.createLead({ name: 'A', phone: '9876543210', product: 'Air fryer' }, 1);
  L.applyAnswer(lead, 'only one piece');
  assert.equal(lead.step, 'done');
  assert.equal(L.grade(lead), 'single');
});

test('people who clicked by mistake are closed', () => {
  const lead = L.createLead({ name: 'A', phone: '9876543210' }, 1);
  L.applyAnswer(lead, 'sorry clicked by mistake');
  assert.equal(L.grade(lead), 'closed');
  assert.equal(lead.step, 'done');
});

test('grades by quantity', () => {
  const g = (q) => L.grade({ qty: q });
  assert.equal(g(500), 'hot');
  assert.equal(g(50), 'hot');
  assert.equal(g(49), 'warm');
  assert.equal(g(10), 'warm');
  assert.equal(g(9), 'low');
  assert.equal(g(2), 'low');
  assert.equal(g(1), 'single');
  assert.equal(g(null), 'warm');
});

test('control characters and long text in form fields are cleaned', () => {
  const lead = L.createLead({ name: 'A\u0000\nB'.repeat(60), phone: '9876543210', message: 'x'.repeat(2000) }, 1);
  assert.ok(lead.name.length <= 80);
  assert.ok(!/[\u0000-\u001f]/.test(lead.name));
  assert.ok(lead.note.length <= 500);
});
