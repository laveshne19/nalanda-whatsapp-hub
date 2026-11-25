'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { notifyStaff } = require('./notify');
const { istDate, istHour } = require('./util');

const MAX_ITEMS = 4000;
const MAX_SEEN = 6000;

/** Read the words in a payment screenshot with tesseract. Returns '' if it cannot. */
function ocrBuffer(buf) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `pay-${process.pid}-${Date.now()}.img`);
    try {
      fs.writeFileSync(file, buf);
    } catch {
      resolve('');
      return;
    }
    execFile('tesseract', [file, 'stdout', '--psm', '6'], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      fs.rm(file, { force: true }, () => {});
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

const toNum = (s) => Number(String(s).replace(/,/g, ''));

/** Pull the amount and mode out of the OCR text. Amount is 0 when nothing reliable was read. */
function parsePayment(ocr) {
  const text = String(ocr || '').replace(/\s+/g, ' ');
  let amount = 0;
  const cands = [];
  for (const m of text.matchAll(/(?:₹|₹|Rs\.?|INR|\$|%|£|€)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]{3,8}(?:\.[0-9]{1,2})?)/gi)) cands.push(toNum(m[1]));
  if (!cands.length) for (const m of text.matchAll(/\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?)\b/g)) cands.push(toNum(m[1]));
  const sane = cands.filter((n) => n >= 10 && n <= 5000000);
  if (sane.length) amount = sane[0];
  const mode = /UPI|Google\s?Pay|GPay|PhonePe|Paytm|BHIM/i.test(text)
    ? 'UPI'
    : /NEFT/i.test(text)
      ? 'NEFT'
      : /IMPS/i.test(text)
        ? 'IMPS'
        : /RTGS/i.test(text)
          ? 'RTGS'
          : /cheque|chq|clearing/i.test(text)
            ? 'Cheque'
            : /cash/i.test(text)
              ? 'Cash'
              : '';
  return { amount, mode };
}

const prettyDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const hhmm = (ms) => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

function ledger(state) {
  return state.data.payLog || (state.data.payLog = { seen: [], items: [], lastScan: 0, summaryDate: null });
}

/** Look up logged payments by amount (and optionally a date, YYYY-MM-DD). */
function findPayments(state, amount, ymd) {
  const L = ledger(state);
  return L.items.filter((x) => x.amount === amount && (!ymd || x.date === ymd));
}

/**
 * Every 30 minutes: read new payment screenshots in the payments group, read the amount from each,
 * and keep a ledger of date, party name (the caption people write) and amount.
 */
async function scanPayments(deps) {
  const { state, config } = deps;
  const cfg = config.payments;
  const client = deps.payClient;
  if (!cfg || !cfg.groupId || !client) return 0;
  const now = deps.now ? deps.now() : Date.now();
  const L = ledger(state);
  if (now - L.lastScan < cfg.everyMinutes * 60000) return 0;
  L.lastScan = now;
  const log = deps.log || (() => {});
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ocr = deps.ocr || ocrBuffer;

  let msgs;
  try {
    msgs = await client.history(cfg.groupId, 100);
  } catch (e) {
    log(`[paymentlog] ${e.message}`);
    return 0;
  }
  const seen = new Set(L.seen);
  const fresh = msgs.filter((m) => m && m.type === 'image' && m.id && !seen.has(m.id)).sort((a, b) => a.timestamp - b.timestamp);
  // the first ever run only looks at the last two days, so it never floods the log with old pictures
  const floor = L.items.length || L.seen.length ? 0 : now - 2 * 86400000;
  let added = 0;
  let handled = 0;
  for (const m of fresh) {
    const ms = m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000;
    if (ms < floor) { L.seen.push(m.id); continue; }
    if (handled >= cfg.maxPerRun) break;
    handled += 1;
    let text = '';
    try {
      const buf = await client.media(cfg.groupId, m.id);
      text = buf ? await ocr(buf) : '';
    } catch (e) {
      if (e.status === 429) { await sleep(8000); handled -= 1; break; } // busy: try again next time
      log(`[paymentlog] picture skipped: ${e.message}`);
    }
    const { amount, mode } = parsePayment(text);
    L.seen.push(m.id);
    if (m.fromMe) continue; // our own sends (bill numbers etc), not customer payments
    L.items.push({ id: m.id, ts: ms, date: istDate(ms), party: String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 80), amount, mode });
    added += 1;
    await sleep(cfg.pauseMs);
  }
  if (L.items.length > MAX_ITEMS) L.items.splice(0, L.items.length - MAX_ITEMS);
  if (L.seen.length > MAX_SEEN) L.seen.splice(0, L.seen.length - MAX_SEEN);
  state._save();
  return added;
}

/** Each evening: tell the owner which payments came into the group today. */
async function maybeSendPaymentSummary(deps) {
  const { state, config } = deps;
  const cfg = config.payments;
  if (!cfg || !cfg.groupId) return false;
  const now = deps.now ? deps.now() : Date.now();
  const today = istDate(now);
  const L = ledger(state);
  if (L.summaryDate === today || istHour(now) < cfg.summaryHour) return false;
  const todays = L.items.filter((x) => x.date === today);
  L.summaryDate = today;
  state._save();
  if (!todays.length) return notifyStaff(deps, `No payment screenshots came into the payments group today (${prettyDay(today)}).`);
  const lines = todays.map((x, i) => `${i + 1}. ${x.party || '(no name written)'}${x.amount ? ', ' + inr(x.amount) : ', amount not readable'}${x.mode ? ', ' + x.mode : ''} (${hhmm(x.ts)})`);
  const total = todays.reduce((a, x) => a + x.amount, 0);
  return notifyStaff(deps, `Payment screenshots in the group today (${prettyDay(today)}):\n${lines.join('\n')}\n\nTotal read: ${inr(total)}. Check any "amount not readable" ones by hand.`);
}

module.exports = { scanPayments, maybeSendPaymentSummary, parsePayment, findPayments, ocrBuffer };
