'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, extractOrderNumber } = require('../src/intents');

const cases = [
  ['hi', 'menu'],
  ['Hello', 'menu'],
  ['namaste', 'menu'],
  ['1', 'tracking'],
  ['2', 'order'],
  ['3', 'bulk'],
  ['4', 'human'],
  ['where is my order #1234', 'tracking'],
  ['track my parcel', 'tracking'],
  ['order status 4521', 'tracking'],
  ['mera order kahan hai', 'tracking'],
  ['#1234', 'tracking'],
  ['1234', 'tracking'],
  ['I want to place an order', 'order'],
  ['price of the 20000mAh power bank', 'order'],
  ['catalogue please', 'order'],
  ['bulk order for 500 pcs', 'bulk'],
  ['corporate gifting quote', 'bulk'],
  ['I am a dealer, need wholesale rates', 'bulk'],
  ['delivery time for 300 pieces', 'bulk'],
  ['I want a refund', 'human'],
  ['please cancel my order', 'cancel'],
  ['order cancel karo #1234', 'cancel'],
  ['I want to cancel', 'cancel'],
  ['talk to someone', 'human'],
  ['STOP', 'opt_out'],
  ['unsubscribe', 'opt_out'],
  ['start', 'opt_in'],
  ['asdfgh', 'unknown'],
  ['', 'unknown'],
];

for (const [text, intent] of cases) {
  test(`"${text}" -> ${intent}`, () => {
    assert.equal(classify(text).intent, intent);
  });
}

test('order number is extracted in common forms', () => {
  assert.equal(extractOrderNumber('where is #1234'), '1234');
  assert.equal(extractOrderNumber('order no. 5678 please'), '5678');
  assert.equal(extractOrderNumber('order number: 90123'), '90123');
  assert.equal(extractOrderNumber('1234'), '1234');
});

test('a phone number is never mistaken for an order number', () => {
  assert.equal(extractOrderNumber('9876543210'), null);
  assert.equal(extractOrderNumber('+91 98765 43210'), null);
  assert.equal(classify('9876543210').intent, 'unknown');
});

test('tracking keeps the order number', () => {
  assert.deepEqual(classify('track order #4521'), { intent: 'tracking', orderNumber: '4521' });
});
