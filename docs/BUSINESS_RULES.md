# Business rules (set by the owner)

Keep it simple. The bot answers Shopify store customers on WhatsApp, any time of day, every day of the week, because customers and bulk buyers message on Sundays and at night too. The team calls customers from 11 AM to 7 PM.

## What the bot does

1. **Order tracking.** Find the order in Shopify, send the courier and tracking ID.
2. **Order confirmation ("is my order confirmed?").** If the order exists in Shopify under their phone number, reply that it is confirmed and that the team will call once to confirm the details. We call every single unit order to make sure the buyer is serious, because of COD returns. If no order is found, ask for the order number. Never say "confirmed" without an order.
3. **Bulk or wholesale enquiry.** Ask for product, quantity, company and city, delivery date, then alert the owner (+91 95699 13332).
4. **Shipping notification.** Every day at 6 PM IST, send each customer whose order was shipped that day a WhatsApp with the courier and tracking ID. Each order is sent only once.

## Not in this project

Broadcast messages to a list of numbers (for example 100 a day) will be a separate project. Do not mix it in here.

## Tone

- Human, polite, short. No em dashes or en dashes in any customer message.
- The bot never cancels or refunds by itself. The team does that.
