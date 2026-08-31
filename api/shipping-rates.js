const { getShippingZone } = require('./_catalog');
const { quoteRates } = require('./_dhl');

// POST { items: [{name, quantity}], destination: { country, city, postal } }
// → { rates: [{ code, name, amountCents, minDays, maxDays }], fallback: bool }
//
// Live DHL Express quotes from Bogotá; if DHL is unreachable or returns
// nothing usable, degrades to the flat fallback zone rate so checkout
// still works.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items, destination } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }
  const dest = destination || {};
  const zone = getShippingZone(dest.country);
  if (!zone) {
    return res.status(400).json({ error: 'We do not ship to that country yet — email chris@pointoforigin.coffee' });
  }
  if (!dest.city || String(dest.city).trim().length < 2) {
    return res.status(400).json({ error: 'Please enter a city' });
  }

  try {
    const rates = await quoteRates(
      items,
      { country: zone.code, city: String(dest.city).trim(), postal: String(dest.postal || '').trim() }
    );
    if (rates.length > 0) {
      return res.status(200).json({ rates: rates, fallback: false });
    }
    throw new Error('DHL returned no usable rates');
  } catch (err) {
    console.error('Live rate quote failed, using fallback zone:', err.message);
    return res.status(200).json({
      rates: [{
        code: 'FALLBACK',
        name: zone.zone.label,
        amountCents: zone.zone.amount,
        minDays: zone.zone.delivery.min,
        maxDays: zone.zone.delivery.max,
      }],
      fallback: true,
    });
  }
};
