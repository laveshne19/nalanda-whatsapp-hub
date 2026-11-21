# Nalanda WhatsApp Hub

A small private service that sits next to OpenWA on the VPS and answers customers on the
company WhatsApp number.

## What it does today
- Greets people and shows a menu (track an order, orders and products, bulk or corporate, talk to the team).
- **Order tracking** from Shopify. It shows status, courier and tracking number, but only when the
  customer messages from the phone number on the order.
- **Bulk and corporate enquiries.** Asks for product, quantity, company and date, then passes the answer to your team.
- **Hand over to a person** for complaints, refunds, cancellations, photos and voice notes. The bot stays quiet for 12 hours in that chat.
- STOP and START for offers, so broadcasts can respect opt-outs later.
- Hinglish works for the common phrases ("order kahan hai").

## Not built yet
Payment follow-ups from Zoho Books or Tally, and offer broadcasts. Both are planned and will reuse this service.

## How it fits together
```
Customer -> WhatsApp -> OpenWA -> (signed webhook) -> this hub
                                                     |-> Shopify (order lookup)
Customer <- WhatsApp <- OpenWA <- (send-text) <------+-> staff note for enquiries
```

## Setup
1. Create a Shopify custom app with the `read_orders` scope only. Put its token in `SHOPIFY_ADMIN_TOKEN`.
   Orders older than 60 days also need `read_all_orders`.
2. In OpenWA create an OPERATOR key for the hub. Put it in `OPENWA_API_KEY`.
3. Set `WEBHOOK_SECRET` to a long random value.
4. On OpenWA set `RESOLVE_LID_TO_PHONE=true` (so the sender's phone number is included) and
   `SSRF_ALLOWED_HOSTS=nalanda-hub` (so OpenWA may call the hub on the private network).
5. Register the webhook in OpenWA for the `message.received` event, URL
   `http://nalanda-hub:8080/webhook/openwa`, with the same secret.
6. Fill `.env` from `.env.example` and start the container.

## Develop
```
npm test
```
No install step, there are no dependencies. Needs Node 20 or newer.

## Tuning
- Wording is in `src/templates.js`. Keep it short and human, and no dashes (a test checks this).
- Keyword rules are in `src/intents.js`. Add a phrase and a test next to it.
- `STAFF_REPLY_PAUSES=true` makes the bot go quiet when a person answers from the phone.
  It depends on OpenWA message ids matching, so try it on the live number first.
