'use strict';

// Deterministic intent rules. No AI model reads customer messages, so nothing
// a customer writes leaves this server. Rules cover English and common Hinglish.

const ORDER_NO_PREFIXED = /(?:#|order\s*(?:no\.?|number|id)?\s*[:\-]?\s*)(\d{3,8})\b/i;
const ORDER_NO_BARE = /\b(\d{3,8})\b/;

function extractOrderNumber(text) {
  const t = String(text || '');
  const prefixed = t.match(ORDER_NO_PREFIXED);
  if (prefixed) return prefixed[1];
  // A bare number counts only when it is not part of a longer digit run,
  // so a 10 digit phone number is never mistaken for an order number.
  const digitsOnly = t.replace(/[\s\-+]/g, '');
  if (/^\d{9,}$/.test(digitsOnly)) return null;
  const bare = t.match(ORDER_NO_BARE);
  return bare ? bare[1] : null;
}

const MENU_DIGIT = { 1: 'tracking', 2: 'order', 3: 'bulk', 4: 'human' };

const RE = {
  optOut: /^\s*(stop|unsubscribe|opt[\s-]?out|band\s+karo)\s*[.!]?\s*$/i,
  optIn: /^\s*(start|subscribe)\s*[.!]?\s*$/i,
  human: /\b(human|agent|representative|executive|real person|call me|speak to|talk to|complaint|refund|baat\s+karni)\b/i,
  cancel: /\bcancel(l?ation|led)?\b|\bcancel\s+(kar|karo|karna)\b/i,
  trackingStrong:
    /\b(track(ing)?|where\s+is\s+my|order\s+status|status\s+of\s+(my\s+)?order|awb|docket|kab\s+(tak\s+)?(aayega|ayega|milega|pahunchega)|kahan\s+hai)\b/i,
  trackingWeak: /\b(dispatch(ed)?|shipped|shipment|delivery|delivered|courier|parcel)\b/i,
  bulk: /\b(bulk|wholesale|corporate|gifting|gifts?|dealer(ship)?|distributor|distribution|reseller|quantity|qty|quotation|quote|gst\s+invoice|thok|\d+\s*(pcs|pieces|units|nos))\b/i,
  order: /\b(order|buy|purchase|price|rate|catalogue|catalog|available|availability|stock|kharidna|chahiye)\b/i,
  greeting: /^\s*(hi+|hello|hey+|namaste|namaskar|good\s+(morning|afternoon|evening)|menu|help)\b/i,
};

/**
 * @param {string} text
 * @returns {{intent: string, orderNumber: string|null}}
 */
function classify(text) {
  const t = String(text || '').trim();
  const orderNumber = extractOrderNumber(t);
  if (!t) return { intent: 'unknown', orderNumber: null };

  if (RE.optOut.test(t)) return { intent: 'opt_out', orderNumber: null };
  if (RE.optIn.test(t)) return { intent: 'opt_in', orderNumber: null };
  if (/^\s*[1-4]\s*$/.test(t)) return { intent: MENU_DIGIT[t.trim()], orderNumber: null };
  if (RE.human.test(t)) return { intent: 'human', orderNumber };
  if (RE.cancel.test(t)) return { intent: 'cancel', orderNumber };
  if (RE.trackingStrong.test(t)) return { intent: 'tracking', orderNumber };
  if (RE.bulk.test(t)) return { intent: 'bulk', orderNumber: null };
  if (RE.trackingWeak.test(t)) return { intent: 'tracking', orderNumber };
  if (RE.order.test(t)) {
    // "order 1234" with no other context is almost always a tracking question
    return { intent: orderNumber && /^\s*(order\s*)?#?\d+\s*$/i.test(t) ? 'tracking' : 'order', orderNumber };
  }
  if (orderNumber && /^\s*#?\d{3,8}\s*$/.test(t)) return { intent: 'tracking', orderNumber };
  if (RE.greeting.test(t)) return { intent: 'menu', orderNumber: null };
  return { intent: 'unknown', orderNumber: null };
}

module.exports = { classify, extractOrderNumber };
