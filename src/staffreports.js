'use strict';
const crypto = require('node:crypto');
const { sheetToPngPages } = require('./sheetimage');
const { notifyStaff } = require('./notify');
const { istDate, istHour } = require('./util');

const TRY_GAP_MS = 20 * 60 * 1000;
const PAUSE_MS = 8000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const caption = (name, date) =>
  `Hi ${name}, your outstanding list as of ${date} is below. Please follow up on the overdue parties this week and update me on collections.`;

/** Download the workbook. The Drive link must give the xlsx file itself. */
async function fetchSheet(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`sheet download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('the link did not return an Excel file');
  return buf;
}

const plain = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10).split('-').reverse().join('-');
  if (typeof v === 'object') return v.result !== undefined ? plain(v.result) : v.text !== undefined ? v.text : v.richText ? v.richText.map((t) => t.text).join('') : null;
  return v;
};

/** @returns {Promise<Map<string, any[][]>>} sheet name to rows */
async function readWorkbook(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = new Map();
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const vals = row.values.slice(1).map(plain);
      while (vals.length && vals[vals.length - 1] === null) vals.pop();
      rows.push(vals);
    });
    out.set(ws.name, rows);
  });
  return out;
}

/**
 * Once a day, after the sheet is uploaded, send each salesperson a readable picture of their own list.
 * Waits (retrying every 20 minutes) until the file is new, so yesterday's sheet is never sent twice.
 */
async function maybeSendStaffReports(deps) {
  const { state, config } = deps;
  const cfg = config.staffReports;
  if (!cfg || !cfg.url || !cfg.map.length) return 0;
  const now = deps.now ? deps.now() : Date.now();
  const today = istDate(now);
  const sr = state.data.staffReport || (state.data.staffReport = { hash: null, date: null });
  if (sr.date === today || istHour(now) < cfg.hour) return 0;
  if (deps._srAt && now - deps._srAt < TRY_GAP_MS) return 0;
  deps._srAt = now;
  const log = deps.log || (() => {});

  let buf;
  try {
    buf = await fetchSheet(cfg.url, deps.fetchImpl || fetch);
  } catch (e) {
    log(`[staffreports] ${e.message}`);
    return 0;
  }
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash === sr.hash) {
    if (istHour(now) >= cfg.lastHour) {
      sr.date = today;
      state._save();
      await notifyStaff(deps, 'The outstanding sheet was not updated today, so no lists were sent to the team.');
    }
    return 0;
  }

  let sheets;
  try {
    sheets = await (deps.readWorkbook || readWorkbook)(buf);
  } catch (e) {
    log(`[staffreports] could not read the sheet: ${e.message}`);
    return 0;
  }

  const render = deps.render || sheetToPngPages;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const date = prettyDate(today);
  let sentTo = 0;
  const problems = [];
  for (const m of cfg.map) {
    const rows = sheets.get(m.sheet);
    if (!rows) { problems.push(`${m.name || m.sheet} (sheet not found)`); continue; }
    try {
      const pics = await render(rows);
      for (let i = 0; i < pics.length; i++) {
        const text = i === 0 ? m.caption || caption(m.name || m.sheet, date) : `Page ${i + 1} of ${pics.length}`;
        state.rememberBotText(m.chat, text, now);
        await deps.openwa.sendImage(m.chat, pics[i], text, `${(m.name || 'list').replace(/\W+/g, '_')}_${i + 1}.png`);
        await sleep(PAUSE_MS);
      }
      sentTo += 1;
    } catch (e) {
      problems.push(`${m.name || m.sheet} (${e.message})`);
    }
  }
  sr.hash = hash;
  sr.date = today;
  state._save();
  await notifyStaff(deps, `Outstanding lists sent to ${sentTo} of ${cfg.map.length} people.${problems.length ? ` Problems: ${problems.join(', ')}.` : ''}`);
  return sentTo;
}

module.exports = { maybeSendStaffReports, fetchSheet, readWorkbook, prettyDate };
