# Nalanda WhatsApp Hub

A small private service that sits next to OpenWA on the VPS and answers customers on the
company WhatsApp number.

## What it does
**Customers on WhatsApp**
- Greets people and shows a menu (track an order, orders and products, bulk or wholesale, talk to the team). Common Hinglish phrases work ("order kahan hai").
- **Order tracking** from Shopify: status, courier, tracking number. Shown only when the customer messages from the phone number on the order.
- **Order cancellation**: checks the order, and if it has not shipped asks the customer to confirm with YES. The request then goes to your team to cancel and refund in Shopify. Shipped orders are not cancelled here, the team is told instead. The bot never cancels or refunds by itself.
- **Bulk and wholesale**: asks for product, quantity, company and date, gives the customer the wholesale desk number, and alerts the owner.
- **Hand over to a person** for complaints, refunds, photos and voice notes. The bot stays quiet in that chat for 12 hours.
- STOP and START for offers, so broadcasts can respect opt-outs later.

**Website enquiries (corporategiftingindia.co "Get quote")**
- The website form calls the hub. The bot starts a short WhatsApp chat: which item, how many units, by when.
- Sorts the enquiry: 50+ units is hot, 10 to 49 is warm, 2 to 9 is small, 1 piece is sent to the website, "clicked by mistake" is closed.
- The owner gets an alert for each one (hot ones say CALL NOW). If a customer never answers, they are handed to a person after 30 minutes, so no enquiry is lost.

**For the owner, on WhatsApp**
- A report arrives every evening (default 8pm India time).
- Message the bot `report` for today's numbers, `leads` for who needs a call, `done ABC123` when you have called.

## Not built yet
Payment follow-ups from Zoho Books or Tally, and offer broadcasts. Both will reuse this service.

## How it fits together
```
Customer -> WhatsApp -> OpenWA -> (signed webhook) -> hub -> Shopify (order lookup)
Customer <- WhatsApp <- OpenWA <- (send-text) <------- hub -> alert and report to the owner
Website form -> server function -> (signed POST /lead/website) -> hub
```

## Setup
See `deploy/docker-compose.yml` and `.env.example`. In short:
1. Shopify custom app with the `read_orders` permission only. Token goes in `SHOPIFY_ADMIN_TOKEN`.
2. In OpenWA, link the number, then create an OPERATOR key for the hub (`HUB_OPENWA_KEY`).
3. Set `HUB_WEBHOOK_SECRET` and `HUB_LEADS_SECRET` to long random values.
4. Start the stack. The hub registers its webhook in OpenWA by itself.

The container image is built by GitHub Actions on every push to `main` (see `.github/workflows/image.yml`).

## Develop
```
npm test
```
No install step, there are no dependencies. Needs Node 20 or newer.

## Tuning
- Wording is in `src/templates.js`. Keep it short and human, and no dashes (a test checks this).
- Keyword rules are in `src/intents.js`. Add a phrase and a test next to it.
- Lead grading thresholds are in `src/leads.js` (`grade`). Confirm the real minimum order quantities with the team before changing what the bot tells customers.
