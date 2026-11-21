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

  const res = await fetchImpl(`https://${shopify.domain}/admin/api/${shopify.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': shopify.token },
    body: JSON.stringify({ query: ORDER_QUERY, variables: { q: `name:#${orderNumber}` } }),
    signal: AbortSignal.timeout(15000),
  });
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

module.exports = { lookupOrder, phoneKey };
