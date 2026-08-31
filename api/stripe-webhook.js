const Stripe = require('stripe');

// Stripe webhook: on checkout.session.completed —
//   1. email an order summary to the team, and
//   2. append the order to the fulfillment Google Sheet
//      (docs/ORDERS-SETUP.md has the full setup guide).
//
// Required env vars (set in Vercel):
//   STRIPE_WEBHOOK_SECRET   — from the webhook endpoint in the Stripe Dashboard
//   RESEND_API_KEY          — from resend.com
// Optional:
//   ORDER_NOTIFY_EMAILS     — comma-separated recipients
//                             (default: chris, bob, and giovanni)
//   ORDER_FROM_EMAIL        — verified sender in Resend
//                             (default: onboarding@resend.dev, which only
//                             delivers to the Resend account owner — set a
//                             real one once the domain is verified)
//   FULFILLMENT_SHEET_URL   — Apps Script web-app URL of the fulfillment sheet
//                             (sheet logging is skipped if unset)
//   FULFILLMENT_SHEET_TOKEN — shared secret; must match TOKEN in the Apps Script

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Pull everything fulfillment needs out of the Stripe session once.
function extractOrder(session, lineItems) {
  const d = session.customer_details || {};
  const addr = (session.shipping_details && session.shipping_details.address) ||
    d.address || {};
  const shipName = (session.shipping_details && session.shipping_details.name) || d.name || '';

  let notes = '';
  (session.custom_fields || []).forEach(function (f) {
    if (f.key === 'order_notes' && f.text && f.text.value) notes = f.text.value;
  });

  const addressLines = [
    shipName,
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
    addr.country,
  ].filter(Boolean);

  return {
    id: session.id,
    date: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    customerName: d.name || 'unknown',
    customerEmail: d.email || '',
    items: lineItems.map(function (li) {
      return li.quantity + 'x ' + li.description + ' — $' + (li.amount_total / 100).toFixed(2);
    }),
    shippingCost: session.shipping_cost ? session.shipping_cost.amount_total / 100 : 0,
    total: session.amount_total / 100,
    currency: String(session.currency || 'usd').toUpperCase(),
    address: addressLines.join('\n'),
    country: addr.country || '',
    notes: notes,
    paymentUrl: 'https://dashboard.stripe.com/payments/' + session.payment_intent,
  };
}

function formatOrderEmail(order) {
  const lines = [];
  lines.push('New order on pointoforigin.coffee');
  lines.push('');
  order.items.forEach(function (i) { lines.push(i); });
  lines.push('');
  lines.push('Shipping: $' + order.shippingCost.toFixed(2));
  lines.push('Total: $' + order.total.toFixed(2) + ' ' + order.currency);
  lines.push('');
  lines.push('Customer: ' + order.customerName + ' <' + (order.customerEmail || 'no email') + '>');
  lines.push('');
  lines.push('Ship to:');
  order.address.split('\n').forEach(function (l) { lines.push('  ' + l); });
  if (order.notes) {
    lines.push('');
    lines.push('Order notes: ' + order.notes);
  }
  lines.push('');
  lines.push('Stripe payment: ' + order.paymentUrl);
  lines.push('');
  lines.push('This order was also added to the fulfillment sheet — mark it Shipped there once it goes out.');
  return lines.join('\n');
}

async function sendEmail(order) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const to = (process.env.ORDER_NOTIFY_EMAILS ||
    'chris@pointoforigin.coffee,bob@pointoforigin.coffee,giovanni@pointoforigincoffee.com')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const from = process.env.ORDER_FROM_EMAIL ||
    'Point of Origin Orders <onboarding@resend.dev>';
  const subject = 'New order — $' + order.total.toFixed(2) +
    (order.customerName !== 'unknown' ? ' from ' + order.customerName : '');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: from, to: to, subject: subject, text: formatOrderEmail(order) }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error('Resend API error ' + resp.status + ': ' + body);
  }
}

// Append the order to the fulfillment Google Sheet via its Apps Script
// web app. The script dedupes on order id, so Stripe retries are safe.
async function appendToSheet(order) {
  const url = process.env.FULFILLMENT_SHEET_URL;
  if (!url) {
    console.warn('FULFILLMENT_SHEET_URL not set — skipping sheet logging');
    return;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: process.env.FULFILLMENT_SHEET_TOKEN || '',
      order: {
        id: order.id,
        date: order.date,
        customer: order.customerName,
        email: order.customerEmail,
        items: order.items.join('\n'),
        shipping: order.shippingCost,
        total: order.total,
        address: order.address,
        country: order.country,
        notes: order.notes,
        payment_url: order.paymentUrl,
      },
    }),
    redirect: 'follow',
  });
  const body = await resp.text();
  if (!resp.ok || body.indexOf('"ok"') === -1) {
    throw new Error('Fulfillment sheet error ' + resp.status + ': ' + body.slice(0, 200));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['line_items'],
    });
    const order = extractOrder(session, (session.line_items && session.line_items.data) || []);

    // Attempt both even if one fails; a non-200 below makes Stripe retry
    // with backoff, and the sheet's id-dedupe keeps retries from double-logging.
    const results = await Promise.allSettled([sendEmail(order), appendToSheet(order)]);
    const failures = results.filter(function (r) { return r.status === 'rejected'; });
    if (failures.length > 0) {
      failures.forEach(function (f) { console.error('Order handling failed:', f.reason.message); });
      return res.status(500).json({ error: 'Failed to process order notification' });
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Order notification failed:', err.message);
    return res.status(500).json({ error: 'Failed to process order notification' });
  }
};

// Signature verification needs the raw request body.
module.exports.config = { api: { bodyParser: false } };
