'use strict';

const IST = 'Asia/Kolkata';

/** YYYY-MM-DD in India time. */
function istDate(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: IST });
}

/** Hour of day 0-23 in India time. */
function istHour(now = Date.now()) {
  return Number(new Date(now).toLocaleString('en-GB', { timeZone: IST, hour: '2-digit', hour12: false })) % 24;
}

function istPretty(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
}

/** Strip control characters and collapse whitespace; cap the length. */
function clean(value, max = 200) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Run an async function, retrying on failure. Used at start-up, when OpenWA may still be
 * coming up after a restart. Throws the last error once the attempts run out.
 */
async function retry(fn, { tries = 12, delayMs = 15000, onRetry = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < tries) {
        onRetry(attempt, e);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

module.exports = { istDate, istHour, istPretty, clean, retry };
