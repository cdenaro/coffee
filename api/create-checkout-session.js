const Stripe = require('stripe');
const { getPrice, getShippingZone } = require('./_catalog');
const { quoteRates } = require('./_dhl');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { items, destination, rateCode } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const dest = destination || {};
    const zone = getShippingZone(dest.country);
    if (!zone) {
      return res.status(400).json({ error: 'Please select a shipping destination' });
    }

    // Prices come from the server-side catalog, never from the client.
    const line_items = [];
    for (const item of items) {
      const price = getPrice(item.name);
      const quantity = Math.floor(Number(item.quantity));
      if (price === null) {
        return res.status(400).json({
          error: 'Unrecognized item in cart: "' + item.name + '". Please remove it and re-add from the product page.',
        });
      }
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) {
        return res.status(400).json({ error: 'Invalid quantity for "' + item.name + '"' });
      }
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: item.name },
          unit_amount: price * 100,
        },
        quantity: quantity,
      });
    }

    // Shipping is re-quoted server-side (the client's displayed price is
    // advisory only); DHL failure degrades to the flat fallback zone rate.
    let shippingOption = {
      code: 'FALLBACK',
      name: zone.zone.label,
      amountCents: zone.zone.amount,
      minDays: zone.zone.delivery.min,
      maxDays: zone.zone.delivery.max,
    };
    if (dest.city) {
      try {
        const rates = await quoteRates(
          items,
          { country: zone.code, city: String(dest.city).trim(), postal: String(dest.postal || '').trim() }
        );
        const match = rates.find(function (r) { return r.code === rateCode; });
        if (match) {
          shippingOption = match;
        } else if (rates.length > 0 && rateCode !== 'FALLBACK') {
          shippingOption = rates[0];
        }
      } catch (err) {
        console.error('Checkout shipping quote failed, using fallback zone:', err.message);
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: [zone.code],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingOption.amountCents, currency: 'usd' },
            display_name: shippingOption.name,
            delivery_estimate: {
              minimum: { unit: 'business_day', value: shippingOption.minDays },
              maximum: { unit: 'business_day', value: shippingOption.maxDays },
            },
          },
        },
      ],
      custom_fields: [
        {
          key: 'order_notes',
          label: { type: 'custom', custom: 'Order Notes (optional)' },
          type: 'text',
          optional: true,
        },
      ],
      success_url: req.headers.origin + '/order-confirmation.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: req.headers.origin + '/checkout.html',
      metadata: {
        order_source: 'website',
        ship_country: zone.code,
        ship_rate_code: shippingOption.code,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
