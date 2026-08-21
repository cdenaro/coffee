const Stripe = require('stripe');

// Stripe webhook: on checkout.session.completed, email an order summary to
// the fulfillment inbox(es) so every paid order triggers a "go ship this".
//
// Required env vars (set in Vercel):
//   STRIPE_WEBHOOK_SECRET  — from the webhook endpoint in the Stripe Dashboard
//   RESEND_API_KEY         — from resend.com
// Optional:
//   ORDER_NOTIFY_EMAILS    — comma-separated recipients
//                            (default: chris@ and bob@pointoforigin.coffee)
//   ORDER_FROM_EMAIL       — verified sender in Resend
//                            (default: onboarding@resend.dev, which only
//                            delivers to the Resend account owner — set a
//                            real one once the domain is verified)

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function formatOrderEmail(session, lineItems) {
  const d = session.customer_details || {};
  const addr = (session.shipping_details && session.shipping_details.address) ||
    d.address || {};
  const shipName = (session.shipping_details && session.shipping_details.name) || d.name || '';

  let notes = '';
  (session.custom_fields || []).forEach(function (f) {
    if (f.key === 'order_notes' && f.text && f.text.value) notes = f.text.value;
  });

  const lines = [];
  lines.push('New order on pointoforigin.coffee');
  lines.push('');
  lineItems.forEach(function (li) {
    lines.push(li.quantity + 'x ' + li.description + ' — $' + (li.amount_total / 100).toFixed(2));
  });
  lines.push('');
  const shippingCost = session.shipping_cost ? session.shipping_cost.amount_total : 0;
  lines.push('Shipping: $' + (shippingCost / 100).toFixed(2));
  lines.push('Total: $' + (session.amount_total / 100).toFixed(2) + ' ' + String(session.currency || 'usd').toUpperCase());
  lines.push('');
  lines.push('Customer: ' + (d.name || 'unknown') + ' <' + (d.email || 'no email') + '>');
  lines.push('');
  lines.push('Ship to:');
  lines.push('  ' + shipName);
  if (addr.line1) lines.push('  ' + addr.line1);
  if (addr.line2) lines.push('  ' + addr.line2);
  lines.push('  ' + [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '));
  lines.push('  ' + (addr.country || ''));
  if (notes) {
    lines.push('');
    lines.push('Order notes: ' + notes);
  }
  lines.push('');
  lines.push('Stripe payment: https://dashboard.stripe.com/payments/' + session.payment_intent);
  return lines.join('\n');
}

async function sendEmail(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const to = (process.env.ORDER_NOTIFY_EMAILS ||
    'chris@pointoforigin.coffee,bob@pointoforigin.coffee')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const from = process.env.ORDER_FROM_EMAIL ||
    'Point of Origin Orders <onboarding@resend.dev>';

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: from, to: to, subject: subject, text: text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error('Resend API error ' + resp.status + ': ' + body);
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
    const lineItems = (session.line_items && session.line_items.data) || [];
    const total = '$' + (session.amount_total / 100).toFixed(2);
    const who = session.customer_details && session.customer_details.name;
    const subject = 'New order — ' + total + (who ? ' from ' + who : '');

    await sendEmail(subject, formatOrderEmail(session, lineItems));
    return res.status(200).json({ received: true });
  } catch (err) {
    // Non-200 makes Stripe retry with backoff, so a transient email failure
    // still ends in a delivered notification.
    console.error('Order notification failed:', err.message);
    return res.status(500).json({ error: 'Failed to process order notification' });
  }
};

// Signature verification needs the raw request body.
module.exports.config = { api: { bodyParser: false } };
