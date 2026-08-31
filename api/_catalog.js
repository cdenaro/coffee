// Canonical product catalog — the single source of truth for prices.
// Cart line items arrive as "<Product Name> (<size>)"; checkout validates
// every item against this map and uses these prices, never client-sent ones.
// Prices are USD retail (2x wholesale, rounded), per Pricing_PRD_Cof070126.

const PRICES = {
  // Macizo — 340g / 500g
  'Macizo Santander (340g)': 25,
  'Macizo Santander (500g)': 31,
  'Macizo Cundinamarca Blend (340g)': 26,
  'Macizo Cundinamarca Blend (500g)': 35,
  'Macizo Pink Bourbon (340g)': 32,
  'Macizo Pink Bourbon (500g)': 38,
  'Macizo Caturra (340g)': 25,
  'Macizo Caturra (500g)': 31,
  'Macizo Special Edition Java (340g)': 38,
  'Macizo Special Edition Java (500g)': 46,
  'Macizo Java Natural (340g)': 44,
  'Macizo Java Natural (500g)': 56,
  'Macizo Gesha (340g)': 44,
  'Macizo Gesha (500g)': 59,
  'Macizo House Blend (340g)': 29,
  'Macizo House Blend (500g)': 38,
  'Macizo House Blend Reloaded (340g)': 32,
  'Macizo House Blend Reloaded (500g)': 38,
  // Expresiones — 250g only
  'Expresiones Castillo (250g)': 22,
  'Expresiones Bourbon Naranja (250g)': 27,
  'Expresiones Geisha (250g)': 33,
  'Expresiones Wush Wush (250g)': 38,
  'Expresiones SL-28 (250g)': 47,
};

// Fallback shipping zones — used ONLY when a live DHL quote fails (see
// api/_dhl.js), so checkout never breaks. Amounts are USD cents, set
// conservatively for a Bogotá origin; adjust here if DHL pricing shifts.
const SHIPPING_ZONES = {
  CO: {
    label: 'Colombia Shipping',
    amount: 1500,
    countries: ['CO'],
    delivery: { min: 2, max: 5 },
  },
  AMERICAS: {
    label: 'DHL Express Shipping (incl. import fees)',
    amount: 5000,
    countries: ['US', 'CA', 'MX', 'PA', 'CR', 'PE', 'CL', 'AR', 'BR', 'UY'],
    delivery: { min: 3, max: 8 },
  },
  INTL: {
    label: 'DHL Express Shipping (incl. import fees)',
    amount: 6500,
    countries: [
      'AE', 'AT', 'AU', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
      'GB', 'GR', 'HK', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'JP', 'KR', 'LT',
      'LU', 'LV', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SA', 'SE', 'SG', 'SI',
      'SK', 'TW',
    ],
    delivery: { min: 4, max: 12 },
  },
};

function getPrice(itemName) {
  return Object.prototype.hasOwnProperty.call(PRICES, itemName)
    ? PRICES[itemName]
    : null;
}

function getShippingZone(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  for (const zone of Object.values(SHIPPING_ZONES)) {
    if (zone.countries.includes(code)) {
      return { code, zone };
    }
  }
  return null;
}

module.exports = { PRICES, SHIPPING_ZONES, getPrice, getShippingZone };
