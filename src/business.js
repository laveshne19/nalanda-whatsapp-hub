'use strict';

// Owner's working rules (see docs/BUSINESS_RULES.md): Monday to Saturday, 11 AM to 7 PM IST.
// Orders are dispatched on working days only.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OPEN_HOUR = 11;
const CLOSE_HOUR = 19;
const IST_MS = 5.5 * 3600 * 1000;

function istParts(now) {
  const d = new Date(now + IST_MS);
  return { day: d.getUTCDay(), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

/** @returns {{when:'today'|'tomorrow'|'weekday', label:string}} the next working day to dispatch an order placed now. */
function dispatchDay(now = Date.now()) {
  const { day, hour } = istParts(now);
  if (day !== 0 && hour < CLOSE_HOUR) return { when: 'today', label: 'today' };
  let next = (day + 1) % 7;
  let ahead = 1;
  while (next === 0) { next = (next + 1) % 7; ahead++; }
  return ahead === 1 && day !== 0 ? { when: 'tomorrow', label: 'tomorrow' } : { when: 'weekday', label: DAYS[next] };
}

module.exports = { dispatchDay, OPEN_HOUR, CLOSE_HOUR };
