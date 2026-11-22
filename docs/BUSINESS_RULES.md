# Business rules (set by the owner)

Keep it simple. The bot answers Shopify store customers on WhatsApp, any time of day, every day of the week, because customers and bulk buyers message on Sundays and at night too. The team calls customers from 11 AM to 7 PM.

## What the bot does

1. **Order tracking.** Find the order in Shopify, send the courier and tracking ID.
2. **Order confirmation ("is my order confirmed?").** If the order exists in Shopify under their phone number, reply that it is confirmed and that the team will call once to confirm the details. We call every single unit order to make sure the buyer is serious, because of COD returns. If no order is found, ask for the order number. Never say "confirmed" without an order.
3. **Bulk or wholesale enquiry.** Ask for product, quantity, company and city, delivery date, then alert the owner (+91 95699 13332).
4. **Shipping notification.** Every day at 6 PM IST, send each customer whose order was shipped that day a WhatsApp with the courier and tracking ID. Each order is sent only once.

## Three separate areas (one WhatsApp number for now)

1. **Shopify store:** tracking, confirmation, shipping notifications (above). Spotted by an order number or words like order, dispatch, tracking.
2. **Corporate Gifting India:** the customer taps "Get quote" on the website and arrives with a standard enquiry message. The bot says we can serve you, asks quantity, delivery place and lead time, never refuses anyone, and passes serious bulk leads (about 10 units and up) to 3332 for a call. If the customer goes quiet, one or two gentle follow-ups a day for 4 days, then stop.
3. **Distribution broadcast (later, separate project):** the owner's Excel list of dealers, about 100 messages a day from a template the owner approves. Replies and price list requests go to 3332. A product price list will be shared by the owner.

Messages can go out at any time. Only the phone calls are limited to 11 AM to 7 PM. If one number is not enough later, a second number will be connected.

## Not in this project

Broadcast messages to a list of numbers (for example 100 a day) will be a separate project. Do not mix it in here.

## Tone

- Human, polite, short. No em dashes or en dashes in any customer message.
- The bot never cancels or refunds by itself. The team does that.
