'use strict';
const crypto = require('node:crypto');
const { clean } = require('./util');

// Website enquiry ("Get quote") qualification. Plain rules, no AI reading customer text.
// The goal: tell a real bulk buyer from someone who clicked by mistake or wants one piece.

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

function makeRef(rand = crypto.randomBytes) {
  let s = '';
  for (const b of rand(6)) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return s;
}

/** Indian mobile numbers become 91XXXXXXXXXX. Other international numbers pass through as digits. */
function normalizePhone(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0') && /^[6-9]/.test(d[1])) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d[2])) return d;
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d;
  return '';
}

/** The reference a customer carries into WhatsApp from the website, like "ref K7M2QX". */
function findRef(text) {
  const m = /\bref(?:erence)?\s*[:#-]?\s*([A-HJ-NP-Z2-9]{6})\b/i.exec(String(text || ''));
  return m ? m[1].toUpperCase() : null;
}

const UNIT = '(?:pcs?|pieces?|units?|nos\\.?|numbers?|sets?|boxes|box|kits?|packs?)';

/**
 * Pull a quantity out of free text.
 * loose=true is for the moment we just asked "how many?", where a bare number is the answer.
 */
function parseQty(text, { loose = false } = {}) {
  const t = String(text || '').toLowerCase().replace(/(\d),(\d{3})/g, '$1$2');
  if (/\b(single|only one|just one|one (piece|unit|item|set))\b/.test(t)) return 1;
  let m = new RegExp(`(\\d{1,7})\\s*${UNIT}(?![a-z])`).exec(t);
  if (!m) m = /\bqty\s*[:=]?\s*(\d{1,7})\b/.exec(t);
  if (!m && loose) m = /(?:^|[^\d])(\d{1,7})(?:[^\d]|$)/.exec(t);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 1000000 ? n : null;
}

// The website form offers quantity ranges ("50 - 200 pieces"), not exact numbers.
// A range is only a hint: the bot still asks for the exact figure.
const RANGE = /(\d[\d,]*)\s*(?:\u2013|\u2014|-|to)\s*(\d[\d,]*)|\b(?:under|below|above|over)\s*(\d[\d,]*)/i;

function hintMin(text) {
  const t = String(text || '');
  const num = (x) => parseInt(String(x).replace(/,/g, ''), 10);
  let m = /\b(?:above|over)\s*(\d[\d,]*)/i.exec(t);
  if (m) return num(m[1]);
  if (/\b(?:under|below)\b/i.test(t)) return 1;
  m = /(\d[\d,]*)\s*(?:\u2013|\u2014|-|to)\s*\d[\d,]*/i.exec(t);
  return m ? num(m[1]) : null;
}

const NOT_INTERESTED =
  /\b(not interested|no requirement|no need|just (checking|browsing|looking)|by mistake|wrong (number|form)|no thanks|nahi chahiye|zarurat nahi)\b/i;

function nextStep(lead) {
  if (lead.outcome) return 'done';
  if (!lead.product) return 'item';
  if (!lead.qty && !lead.qtyNote) return 'qty';
  if (!lead.when) return 'when';
  return 'done';
}

function createLead(input, now = Date.now(), rand) {
  const phone = normalizePhone(input.phone);
  const lead = {
    ref: makeRef(rand),
    createdAt: now,
    lastActivity: now,
    status: 'asking',
    started: false,
    completed: false,
    name: clean(input.name, 80),
    company: clean(input.company, 100),
    email: clean(input.email, 120),
    phone,
    chatId: `${phone}@c.us`,
    product: clean(input.product, 120),
    qty: null,
    qtyHint: '',
    occasion: clean(input.occasion, 80),
    budget: clean(input.budget, 60),
    when: clean(input.when, 80),
    note: clean(input.message, 500),
    source: clean(input.source, 60) || 'website',
    page: clean(input.page, 200),
  };
  const qtyText = input.quantity == null ? '' : String(input.quantity);
  if (qtyText) {
    if (RANGE.test(qtyText)) lead.qtyHint = clean(qtyText, 40);
    else lead.qty = parseQty(qtyText, { loose: true });
  }
  lead.step = nextStep(lead);
  return lead;
}

/** Fold one customer reply into the lead and move to the next question. */
function applyAnswer(lead, text, now = Date.now()) {
  const t = clean(text, 300);
  lead.lastActivity = now;

  if (NOT_INTERESTED.test(t)) {
    lead.outcome = 'not_interested';
    lead.step = 'done';
    return lead;
  }

  if (lead.step === 'item') {
    const q = parseQty(t);
    if (q && !lead.qty) lead.qty = q;
    if (!/^\d+$/.test(t)) {
      const withoutQty = t.replace(new RegExp(`\\b\\d{1,7}\\s*${UNIT}(?![a-z])`, 'i'), '').replace(/\s+/g, ' ').trim();
      lead.product = clean(withoutQty || t, 120);
    } else if (!lead.qty) {
      lead.qty = parseQty(t, { loose: true });
    }
  } else if (lead.step === 'qty') {
    const q = parseQty(t, { loose: true });
    if (q) lead.qty = q;
    else {
      lead.qtyTries = (lead.qtyTries || 0) + 1;
      if (lead.qtyTries >= 2) lead.qtyNote = t; // stop nagging, a person will ask
    }
  } else if (lead.step === 'when') {
    lead.when = t;
  }

  if (lead.qty === 1) lead.outcome = 'single';
  lead.step = nextStep(lead);
  return lead;
}

/** closed | single | hot | warm | low */
function grade(lead) {
  if (lead.outcome === 'not_interested') return 'closed';
  if (lead.outcome === 'single' || lead.qty === 1) return 'single';
  if (lead.qty >= 50) return 'hot';
  if (lead.qty >= 10) return 'warm';
  if (lead.qty >= 2) return 'low';
  // exact quantity unknown: a form range of 50+ still counts as hot, otherwise a person decides
  if (lead.qtyHint && hintMin(lead.qtyHint) >= 50) return 'hot';
  return 'warm';
}

function summary(lead) {
  const item = lead.product || 'item not given';
  const qty = lead.qty
    ? `${lead.qty} units`
    : lead.qtyNote
      ? `quantity "${lead.qtyNote}"`
      : lead.qtyHint
        ? `about ${lead.qtyHint}`
        : 'quantity not given';
  const extra = `${lead.occasion ? `, for ${lead.occasion}` : ''}${lead.budget ? `, budget ${lead.budget}` : ''}`;
  return `${item}, ${qty}, needed ${lead.when || 'date not given'}${extra}`;
}

module.exports = { hintMin, makeRef, normalizePhone, findRef, parseQty, createLead, applyAnswer, nextStep, grade, summary };
