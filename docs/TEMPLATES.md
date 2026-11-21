# Customer message templates

Every message the bot can send a customer, with example values. This file is generated from
`src/templates.js`. To change wording, edit that file and run `npm run templates`. A test fails if
this file is out of date.

**House rules for wording:** short, polite, plain language, one question at a time, no em dashes,
no promises about delivery dates, never share order details with a different phone number.

The bot stays silent on anything it does not clearly understand. Your team answers those.

## Greeting and menu

**Customer says hi or hello**

> Hi, thanks for messaging Nalanda Enterprises. How can we help?
> Reply with a number:
> 1  Track my order
> 2  Place an order or ask about a product
> 3  Bulk or corporate enquiry
> 4  Talk to our team

## Order tracking

**Customer asks for tracking without an order number**

> Sure, I can check that. Please send your order number, for example #1234.

**Order shipped, with courier and tracking number**

> Order #1234 has been shipped.
> Courier: DTDC, Tracking number: 7D141348310.
> Track here: https://www.dtdc.in/tracking.asp

**Order not shipped yet**

> Order #1234 is being prepared.

**Order delivered**

> Order #1234 has been shipped.
> It was delivered on 18 Nov 2026.

**Order number not found**

> I could not find order #1234. Please check the number and send it again, or reply 4 to talk to our team.

**Message is from a different phone than the order (privacy)**

> For your privacy I can only share order details when you message from the phone number used on the order. Reply 4 and our team will help you.

**Shopify could not be checked just now**

> I could not check that just now. I have passed it to our team and they will reply here soon.

## Order cancellation

**Customer wants to cancel, no order number given**

> I can help with that. Please send the order number you want to cancel, for example #1234.

**Order has not shipped, ask to confirm**

> Order #1234 has not shipped yet, so it can still be cancelled. Reply YES to cancel it, or NO to keep it.

**Customer confirmed, request sent to the team**

> Done, I have sent your cancellation request for order #1234 to our team. They will confirm here, and any refund goes back to the original payment method.

**Customer said no**

> Okay, order #1234 stays as it is.

**Order was already cancelled**

> Order #1234 is already cancelled.

**Order already shipped, cannot cancel here**

> Order #1234 has already been shipped, so I cannot cancel it here. I have asked our team to help you with a return or refusal at delivery.

## Products, support and people

**Customer asks about ordering or products**

> Happy to help. You can browse and order at https://www.nalandaenterprises.com, or tell us the product and quantity here and our team will confirm the price and availability. Reply 4 to talk to our team.

**Problem with a product, installation, return, warranty**

> Sorry about that, and thank you for telling us. I have passed this to our support team with your message, and they will reply here soon. If you have your order number or a photo of the problem, please send it here.

**Customer asks for a person, or complaint or refund**

> Okay, I have passed this to our team and they will reply here soon. Our hours: 10am to 7pm, Monday to Saturday.

## Bulk, wholesale and corporate gifting

**Bulk or wholesale enquiry**

> Thanks for your bulk or wholesale enquiry. Please share in one message:
> 1) the product(s)
> 2) quantity
> 3) your company name and city
> 4) the date you need delivery by
> Our team will call you with a quote. You can also reach our wholesale desk directly on +91 95699 13332.

**After the customer sends the details**

> Thank you, we have noted this. Our team will get back to you here shortly.

## Website enquiries (Get quote form)

**First message, item not known**

> Hi Rahul, this is Nalanda Enterprises. Thanks for your enquiry for Diwali / Festive Gifting. To get you the right quote quickly: which item are you looking for, and roughly how many units? (Reply STOP to opt out.)

**First message, item known, asking quantity**

> Hi Rahul, this is Nalanda Enterprises. Thanks for your enquiry about steel bottles. To get you the right quote quickly: how many units of steel bottles do you need? (Reply STOP to opt out.)

**Asking the date**

> Thanks. By what date do you need them? A rough date is fine, or say no fixed date.

**Asking again, quantity not understood**

> Sorry, I need a number for the quote, like 50 or 200. How many units do you need?

**Hot lead, 50 or more units**

> Thank you Rahul, we have your enquiry: steel bottles, 200 units, needed 5 Dec, for Diwali / Festive Gifting. Our team will call you shortly.

**Warm lead, 10 to 49 units**

> Thank you Rahul, we have your enquiry: steel bottles, 200 units, needed 5 Dec, for Diwali / Festive Gifting. Our team will call you within one working day.

**Small quantity**

> Thanks Rahul. For small quantities you can order directly at https://www.nalandaenterprises.com. If you would still like a quote, our team will message you.

**One piece, sent to the website**

> Thanks Rahul. For one piece the easiest way is to order directly at https://www.nalandaenterprises.com. If you later need a larger quantity, message us here and we will quote you.

**Clicked by mistake or not interested**

> No problem Rahul, thank you for letting us know. If you need anything later, message us here any time.

**Customer messages again about an enquiry already received**

> We already have your enquiry (ref K7M2QX). Our team will be in touch shortly. If something has changed, just tell us here.

## Offers on or off

**Customer sends STOP**

> You are unsubscribed from offers and updates. You will still get replies about your orders. Send START any time to rejoin.

**Customer sends START**

> You are subscribed to offers and updates. Send STOP any time to unsubscribe.
