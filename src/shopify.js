'use strict';

// Query shape was validated against the live store schema (Admin API 2026-10).
// Customer.phone is deprecated there, so customer.defaultPhoneNumber is used.
const ORDER_QUERY = `query LookupOrder($q: String!) {
  orders(first: 1, query: $q) {
    edges { node {
      name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus phone
      customer { defaultPhoneNumber { phoneNumber } }
      shippingAddress { phone }
      billingAddress { phone }
      fulfillments(first: 5) { status deliveredAt trackingInfo { company number url } }
    } }
  }
}`;

/**
 * Dev Dashboard apps give a client ID and secret, not a permanent token. The hub exchanges
 * them (client credentials grant) for an access token that lasts about 24 hours and asks
 * again when it is close to expiry. One refresh is shared by every request in flight.
 * A fixed token (older custom apps) is still supported.
 */
function createTokenProvider({ domain, clientId, clientSecret, staticToken, fetchImpl = fetch, now = Date.now }) {
  if (staticToken) return { getToken: async () => staticToken, invalidate() {}, scope: () => null };

  let token = null;
  let expiresAt = 0;
  let scope = null;
  let inflight = null;

  async function refresh() {
    const res = await fetchImpl(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // Shopify explains a refusal either as JSON ({"error": ...}) or as a web page whose title says
      // why (for example "400 - Oauth error app_not_installed"). Log that reason, never our secret.
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* no readable body */
      }
      let detail = '';
      try {
        const b = JSON.parse(text);
        const parts = [typeof b.error === 'string' ? b.error : '', typeof b.error_description === 'string' ? b.error_description : ''];
        detail = parts.filter(Boolean).join(': ');
      } catch {
        const t = /<title>([^<]{1,200})<\/title>/i.exec(text);
        if (t) detail = t[1];
      }
      detail = detail.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`Shopify token request failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    const body = await res.json();
    if (!body || !body.access_token) throw new Error('Shopify token response had no access_token');
    token = body.access_token;
    scope = body.scope || null;
    const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    expiresAt = now() + seconds * 1000;
    return token;
  }

  return {
    async getToken() {
      if (token && now() < expiresAt - 5 * 60 * 1000) return token;
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() {
      token = null;
      expiresAt = 0;
    },
    scope: () => scope,
  };
}

/** Last 10 digits, so +91 98765 43210, 098765-43210 and 9876543210 all compare equal. */
function phoneKey(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function orderPhones(node) {
  return [
    node.phone,
    node.customer && node.customer.defaultPhoneNumber && node.customer.defaultPhoneNumber.phoneNumber,
    node.shippingAddress && node.shippingAddress.phone,
    node.billingAddress && node.billingAddress.phone,
  ]
    .map(phoneKey)
    .filter(Boolean);
}

/**
 * @returns {Promise<{found:false}|{found:true, verified:boolean, order?:object}>}
 * Order details are only returned when the sender's phone matches a phone on the order.
 */
async function lookupOrder({ shopify, orderNumber, senderPhone, fetchImpl = fetch }) {
  if (!shopify) throw new Error('Shopify is not configured');
  if (!/^\d{3,8}$/.test(String(orderNumber))) return { found: false };

  const call = async () => {
    const token = shopify.auth ? await shopify.auth.getToken() : shopify.token;
    return fetchImpl(`https://${shopify.domain}/admin/api/${shopify.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query: ORDER_QUERY, variables: { q: `name:#${orderNumber}` } }),
      signal: AbortSignal.timeout(15000),
    });
  };

  let res = await call();
  if (res.status === 401 && shopify.auth) {
    shopify.auth.invalidate(); // token expired or was revoked: get a fresh one, once
    res = await call();
  }
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors && body.errors.length) throw new Error('Shopify GraphQL error');

  const edge = body.data && body.data.orders && body.data.orders.edges[0];
  if (!edge) return { found: false };
  const node = edge.node;

  const sender = phoneKey(senderPhone);
  const verified = Boolean(sender) && orderPhones(node).includes(sender);
  if (!verified) return { found: true, verified: false };

  return {
    found: true,
    verified: true,
    order: {
      name: node.name,
      cancelledAt: node.cancelledAt,
      fulfillmentStatus: node.displayFulfillmentStatus,
      financialStatus: node.displayFinancialStatus,
      fulfillments: node.fulfillments || [],
    },
  };
}

const RECENT_QUERY = `query RecentOrders($q: String!) {
  orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q) {
    edges { node {
      name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus phone
      customer { defaultPhoneNumber { phoneNumber } }
      shippingAddress { phone }
      billingAddress { phone }
      fulfillments(first: 5) { status deliveredAt trackingInfo { company number url } }
    } }
  }
}`;

/**
 * Newest order placed from the sender's own phone number in the last `days` days (read only).
 * Used when a customer asks "is my order confirmed?" without giving a number.
 * @returns {Promise<{found:false}|{found:true, order:object}>}
 */
async function findRecentOrderByPhone({ shopify, senderPhone, days = 30, fetchImpl = fetch, now = Date.now }) {
  if (!shopify) throw new Error('Shopify is not configured');
  const sender = phoneKey(senderPhone);
  if (!sender) return { found: false };
  const since = new Date(now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const call = async () => {
    const token = shopify.auth ? await shopify.auth.getToken() : shopify.token;
    return fetchImpl(`https://${shopify.domain}/admin/api/${shopify.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query: RECENT_QUERY, variables: { q: `created_at:>=${since}` } }),
      signal: AbortSignal.timeout(15000),
    });
  };
  let res = await call();
  if (res.status === 401 && shopify.auth) {
    shopify.auth.invalidate();
    res = await call();
  }
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors && body.errors.length) throw new Error('Shopify GraphQL error');

  const edges = (body.data && body.data.orders && body.data.orders.edges) || [];
  const hit = edges.map((e) => e.node).find((n) => orderPhones(n).includes(sender));
  if (!hit) return { found: false };
  return {
    found: true,
    order: {
      name: hit.name,
      cancelledAt: hit.cancelledAt,
      fulfillmentStatus: hit.displayFulfillmentStatus,
      financialStatus: hit.displayFinancialStatus,
      fulfillments: hit.fulfillments || [],
    },
  };
}

const SHIPPED_QUERY = `query Shipped($q: String!) {
  orders(first: 100, sortKey: UPDATED_AT, reverse: true, query: $q) {
    edges { node {
      name cancelledAt phone
      customer { defaultPhoneNumber { phoneNumber } }
      shippingAddress { phone }
      billingAddress { phone }
      fulfillments(first: 5) { createdAt trackingInfo { company number url } }
    } }
  }
}`;

/**
 * Orders that got a tracking number in the last `hours` hours (read only).
 * @returns {Promise<Array<{name:string, phone:string, fulfillments:Array}>>}
 */
async function listRecentShipments({ shopify, hours = 30, fetchImpl = fetch, now = Date.now }) {
  if (!shopify) throw new Error('Shopify is not configured');
  const cutoff = now() - hours * 3600 * 1000;
  const since = new Date(cutoff - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const call = async () => {
    const token = shopify.auth ? await shopify.auth.getToken() : shopify.token;
    return fetchImpl(`https://${shopify.domain}/admin/api/${shopify.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query: SHIPPED_QUERY, variables: { q: `updated_at:>=${since} fulfillment_status:shipped` } }),
      signal: AbortSignal.timeout(20000),
    });
  };
  let res = await call();
  if (res.status === 401 && shopify.auth) {
    shopify.auth.invalidate();
    res = await call();
  }
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors && body.errors.length) throw new Error('Shopify GraphQL error');

  const out = [];
  for (const e of (body.data && body.data.orders && body.data.orders.edges) || []) {
    const n = e.node;
    if (n.cancelledAt) continue;
    const fresh = (n.fulfillments || []).filter(
      (f) => Date.parse(f.createdAt) >= cutoff && (f.trackingInfo || []).some((t) => t.number),
    );
    if (!fresh.length) continue;
    const phone = [n.phone, n.customer && n.customer.defaultPhoneNumber && n.customer.defaultPhoneNumber.phoneNumber,
      n.shippingAddress && n.shippingAddress.phone, n.billingAddress && n.billingAddress.phone].find((p) => phoneKey(p));
    out.push({ name: n.name, phone: phone || '', fulfillments: fresh });
  }
  return out;
}

module.exports = { lookupOrder, findRecentOrderByPhone, listRecentShipments, phoneKey, createTokenProvider };
