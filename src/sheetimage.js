'use strict';

// Turns one salesperson's sheet (rows of cells) into readable pictures for WhatsApp,
// a few columns per page, so nobody has to open Excel.

const W = 1400;
const RH = 36;
const PAD = 14;
const PAGE_ROWS = 30;

const SLOTS = ['#', 'Party', 'City', 'Mobile', 'Outstanding', 'Oldest bill (days)', 'Up to 30 days', '31 to 60 days', 'Over 60 days'];
const MATCH = [/^#$/, /^party$/i, /^city$/i, /^mobile$/i, /^(total outstanding|balance outstanding)/i, /^(oldest bill age|days overdue)/i];
const BUCKETS = [/^0-10/, /^11-20/, /^21-30/, /^31-45/, /^46-60/, /^60\+/, /^older/i];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmt(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    return Math.abs(v) < 1000 && Number.isInteger(v) ? String(v) : Math.round(v).toLocaleString('en-IN');
  }
  return String(v);
}

const filled = (r) => r.filter((c) => c !== null && c !== undefined && c !== '');

/** Keep the columns a salesperson needs and add three ageing totals. Titles pass through. */
function simplify(rows) {
  let map = null;
  return rows.map((r) => {
    const idx = (re) => r.findIndex((c) => typeof c === 'string' && re.test(c.trim()));
    if (r[0] === '#' && idx(/^party$/i) > -1 && idx(/outstanding/i) > -1) {
      map = { base: MATCH.map(idx), buck: BUCKETS.map(idx) };
      return SLOTS.slice();
    }
    if (!map || filled(r).length <= 1) return r;
    const num = (i) => (i > -1 && typeof r[i] === 'number' ? r[i] : 0);
    const out = map.base.map((i) => (i > -1 ? r[i] : null));
    out.push(num(map.buck[0]) + num(map.buck[1]) + num(map.buck[2]));
    out.push(num(map.buck[3]) + num(map.buck[4]));
    out.push(num(map.buck[5]) + num(map.buck[6]));
    return out;
  });
}

function layout(rows) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const wch = new Array(cols).fill(3);
  rows.forEach((r) => {
    if (filled(r).length <= 1) return;
    r.forEach((c, i) => { wch[i] = Math.max(wch[i], Math.min(fmt(c).length, 34)); });
  });
  const total = wch.reduce((a, b) => a + b + 2, 0);
  const scale = (W - 2 * PAD) / total;
  return { widths: wch.map((w) => (w + 2) * scale), fs: Math.max(16, Math.min(20, Math.floor(scale * 1.7))) };
}

function pageSvg(rows, lay, head, title, pageNo, pages) {
  const body = [];
  let y = 0;
  const draw = (r, kind) => {
    const single = filled(r).length <= 1;
    const bg = kind === 'head' ? '#1f3a5f' : single ? '#e8edf3' : body.length % 2 ? '#f6f8fa' : '#ffffff';
    body.push(`<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${bg}"/>`);
    if (single) {
      const t = r.find((c) => c !== null && c !== undefined && c !== '');
      if (t !== undefined) body.push(`<text x="${PAD}" y="${y + 24}" font-size="${lay.fs + 1}" font-weight="bold" fill="#10243d">${esc(fmt(t).slice(0, 170))}</text>`);
    } else {
      let x = PAD;
      r.forEach((c, i) => {
        const w = lay.widths[i] || 40;
        const isNum = typeof c === 'number';
        const text = esc(fmt(c).slice(0, Math.floor(w / (lay.fs * 0.55)) + 2));
        const weight = kind === 'head' || /TOTAL/i.test(String(r[0] || r[1] || '')) ? 'bold' : 'normal';
        body.push(`<text x="${isNum ? x + w - 8 : x + 4}" y="${y + 24}" font-size="${lay.fs}" font-weight="${weight}" fill="${kind === 'head' ? '#ffffff' : '#1a1a1a'}" text-anchor="${isNum ? 'end' : 'start'}">${text}</text>`);
        x += w;
      });
    }
    y += RH;
  };
  if (title) draw([title], 'title');
  if (head) draw(head, 'head');
  rows.forEach((r) => draw(r, 'row'));
  body.push(`<text x="${W - PAD}" y="${y + 20}" font-size="12" fill="#666" text-anchor="end">Page ${pageNo} of ${pages}</text>`);
  const H = y + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>${body.join('')}</svg>`;
}

/** @returns {string[]} one SVG per page */
function sheetToSvgPages(rawRows) {
  const rows = simplify(rawRows.filter((r) => Array.isArray(r)));
  const lay = layout(rows);
  const title = rows[0] && filled(rows[0])[0] ? String(filled(rows[0])[0]) : '';
  const isHead = (r) => r[0] === '#' || /^party$/i.test(String(r[1] || ''));
  const chunks = [];
  let cur = [];
  let head = null;
  rows.slice(1).forEach((r) => {
    if (isHead(r)) head = r;
    if (!filled(r).length) return;
    cur.push({ r, head });
    if (cur.length >= PAGE_ROWS) { chunks.push(cur); cur = []; }
  });
  if (cur.length) chunks.push(cur);
  return chunks.map((c, p) =>
    pageSvg(c.map((x) => x.r), lay, isHead(c[0].r) ? null : c[0].head, p === 0 ? title : null, p + 1, chunks.length));
}

/** SVG pages to PNG images (base64). sharp is loaded only here so the rest of the hub needs no native code. */
async function sheetToPngPages(rawRows) {
  const sharp = require('sharp');
  const out = [];
  for (const svg of sheetToSvgPages(rawRows)) {
    out.push((await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()).toString('base64'));
  }
  return out;
}

module.exports = { simplify, sheetToSvgPages, sheetToPngPages };
