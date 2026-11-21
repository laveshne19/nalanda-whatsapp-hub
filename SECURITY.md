# Security notes

What this service does and does not do with customer data.

## What stays where
- Customer messages are read by plain rules in `src/intents.js`. No AI service or outside API sees them.
- The only outside calls are to your own OpenWA (to send replies) and to Shopify (to look up an order).
- Logs hold message ids and masked phone numbers (last 4 digits). Message text is never logged.
- The state file (`data/state.json`) holds chat ids, opt-outs and counters, written with mode 600.

## Protections
- Every webhook must carry a valid `X-OpenWA-Signature`. Anything else gets 401 before it is parsed.
- Order details are shown only when the sender's phone matches a phone on the order. Otherwise the customer is told to contact the team and staff are notified.
- Order numbers must be 3 to 8 digits before they go anywhere near a Shopify query.
- Reply budget per chat per hour stops message loops with other bots.
- STOP removes a contact from broadcasts. Order replies still go out.
- Zero npm dependencies, so there is nothing to poison in the supply chain.

## Keep it that way
- Shopify token: custom app, `read_orders` scope only. Rotate it if anyone leaves.
- OpenWA key for the hub: an OPERATOR key, separate from your admin key.
- Do not expose port 8080 to the internet. OpenWA reaches the hub over the private Docker network.

## Known limits
- Unofficial WhatsApp connection through OpenWA. WhatsApp can restrict the number.
- The state file is plain JSON, fine for one number, not for a cluster.
