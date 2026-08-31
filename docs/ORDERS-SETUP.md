# Order notifications & fulfillment setup

What happens when a customer pays, once everything below is configured:

1. Stripe finishes the checkout and calls `/api/stripe-webhook`.
2. The webhook emails an order summary (items, totals, shipping address,
   order notes, Stripe link) to Chris, Bob, and Giovanni.
3. The same order is appended as a row in the **fulfillment Google Sheet**
   with Status `NEW`. Giovanni works from that sheet: mark `SHIPPED`
   (+ date and tracking number) when it goes out, `RECEIVED` when it arrives.

If the email or sheet write fails, the webhook returns an error and Stripe
automatically retries for up to 3 days, so orders don't get lost. Retries
never create duplicate sheet rows (deduped by order ID).

---

## 1. Resend (order emails) — ~10 min

1. Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day).
2. **Domains → Add Domain** → `pointoforigin.coffee` → add the DNS records
   it shows you at your DNS provider → wait for "Verified".
3. **API Keys → Create API Key** → copy it (starts with `re_`).

Until the domain verifies, Resend's test sender only delivers to the
account owner's inbox — do the DNS step.

## 2. Fulfillment Google Sheet — ~10 min

1. Create a Google Sheet named e.g. **POC Orders** (owned by whoever
   runs fulfillment; share it with the rest of the team).
2. **Extensions → Apps Script**, delete the placeholder code, paste in
   [`docs/fulfillment-sheet.gs`](./fulfillment-sheet.gs).
3. Replace `TOKEN = 'CHANGE-ME'` with a long random string. Keep a copy.
4. **Deploy → New deployment → type: Web app** →
   *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy**.
   Authorize when prompted, then copy the **Web app URL**
   (`https://script.google.com/macros/s/…/exec`).

The sheet starts empty — the script writes the header row and each order
automatically, including a Status dropdown per row.

## 3. Stripe webhook — ~5 min

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://coffee-three-lake.vercel.app/api/stripe-webhook`
3. Events: select only **`checkout.session.completed`**.
4. After creating, reveal and copy the **Signing secret** (`whsec_…`).

## 4. Vercel environment variables — ~5 min

Vercel → project → **Settings → Environment Variables** (Production):

| Variable | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 3 |
| `RESEND_API_KEY` | `re_…` from step 1 |
| `ORDER_FROM_EMAIL` | `Point of Origin Orders <orders@pointoforigin.coffee>` (after domain verifies) |
| `FULFILLMENT_SHEET_URL` | Web app URL from step 2 |
| `FULFILLMENT_SHEET_TOKEN` | the token you set in the Apps Script |
| `ORDER_NOTIFY_EMAILS` | *(optional — defaults to chris@, bob@, giovanni@)* |

Redeploy the site after adding them (Deployments → ⋯ → Redeploy).

## 5. Test it

Place a small real order (refund it afterward in Stripe), then check:

- [ ] All three of you got the "New order" email
- [ ] The order appeared in the sheet with Status `NEW`
- [ ] Stripe Dashboard → Webhooks shows the delivery as succeeded

Also worth enabling in Stripe while you're there:
**Settings → Emails → receipts for successful payments** (customer
receipts), and personal notification emails + the Stripe mobile app for
each team member.
