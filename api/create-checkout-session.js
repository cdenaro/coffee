const Stripe = require('stripe');
const { getPrice, getShippingZone } = require('./_catalog');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { items, country } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const shipping = getShippingZone(country);
    if (!shipping) {
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: [shipping.code],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shipping.zone.amount, currency: 'usd' },
            display_name: shipping.zone.label,
            delivery_estimate: {
              minimum: { unit: 'business_day', value: shipping.zone.delivery.min },
              maximum: { unit: 'business_day', value: shipping.zone.delivery.max },
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
        ship_country: shipping.code,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
