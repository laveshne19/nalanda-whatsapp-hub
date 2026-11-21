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
    if (!res.ok) throw new Error(`Shopify token request failed: HTTP ${res.status}`);
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

module.exports = { lookupOrder, phoneKey, createTokenProvider };
