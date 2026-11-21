'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchDay } = require('../src/business');

// IST = UTC + 5:30. 2026-11-21 is a Saturday.
const ist = (iso) => Date.parse(iso + '+05:30');

test('Saturday evening and Sunday ship on Monday', () => {
  assert.equal(dispatchDay(ist('2026-11-21T20:00:00')).label, 'Monday');
  assert.equal(dispatchDay(ist('2026-11-22T12:00:00')).label, 'Monday');
});
test('working hours mean today', () => {
  assert.equal(dispatchDay(ist('2026-11-23T11:30:00')).label, 'today');
  assert.equal(dispatchDay(ist('2026-11-21T09:00:00')).label, 'today');
});
test('weekday evening means tomorrow, Friday evening means tomorrow (Saturday works)', () => {
  assert.equal(dispatchDay(ist('2026-11-23T21:00:00')).label, 'tomorrow');
  assert.equal(dispatchDay(ist('2026-11-27T21:00:00')).label, 'tomorrow');
});
