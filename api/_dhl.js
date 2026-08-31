// DHL Express (MyDHL API) rate quoting — orders ship from Bogotá, Colombia
// on Giovanni's DHL account. Quotes are pass-through: the DHL rate plus an
// import-duties buffer (SHIPPING_DUTIES_PERCENT of the items subtotal),
// rounded up to the next whole dollar, shown to the customer as one price.
//
// Env vars (see docs/ORDERS-SETUP.md):
//   DHL_API_KEY, DHL_API_SECRET — MyDHL API app credentials
//   DHL_ACCOUNT_NUMBER          — Giovanni's DHL Express account
//   DHL_API_BASE                — optional; default production, set
//                                 https://express.api.dhl.com/mydhlapi/test to test
//   SHIPPING_DUTIES_PERCENT     — duties/fees buffer, % of items subtotal (default 10)
//   FX_COP_PER_USD              — used only if DHL quotes in COP (default 4200)

const { getPrice } = require('./_catalog');

// Only what the rating API needs — no street address in the repo.
const ORIGIN = { countryCode: 'CO', cityName: 'Bogota', postalCode: '110131' };

const PACKAGING_PER_BAG_G = 70; // bag + label + padding
const BOX_G = 250;

// grams of coffee, parsed from the item name's "(340g)" suffix
function itemNetGrams(name) {
  const m = /\((\d+)g\)$/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

// One consolidated box per order; size tier by bag count.
function computePackage(items) {
  let bags = 0;
  let grams = BOX_G;
  let subtotal = 0;
  for (const item of items) {
    const net = itemNetGrams(item.name);
    const price = getPrice(item.name);
    const qty = Math.floor(Number(item.quantity));
    if (net === null || price === null || !Number.isFinite(qty) || qty < 1 || qty > 50) {
      return null;
    }
    bags += qty;
    grams += (net + PACKAGING_PER_BAG_G) * qty;
    subtotal += price * qty;
  }
  if (bags === 0) return null;
  const dims = bags <= 2 ? { length: 25, width: 20, height: 10 }
    : bags <= 6 ? { length: 30, width: 25, height: 15 }
    : { length: 40, width: 30, height: 20 };
  return { weightKg: Math.max(0.5, grams / 1000), dims, subtotal, bags };
}

function nextBusinessDay() {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0, 10);
}

function toUsd(totalPrice) {
  const prices = totalPrice || [];
  const usd = prices.find(function (p) { return p.priceCurrency === 'USD' && p.price > 0; });
  if (usd) return usd.price;
  const billed = prices.find(function (p) { return p.currencyType === 'BILLC' && p.price > 0; }) ||
    prices.find(function (p) { return p.price > 0; });
  if (!billed) return null;
  if (billed.priceCurrency === 'USD') return billed.price;
  if (billed.priceCurrency === 'COP') {
    return billed.price / (parseFloat(process.env.FX_COP_PER_USD) || 4200);
  }
  return null; // unknown currency — skip this product rather than guess
}

function transitDays(product) {
  const cap = product.deliveryCapabilities || {};
  if (Number.isFinite(cap.totalTransitDays)) return cap.totalTransitDays;
  if (cap.estimatedDeliveryDateAndTime) {
    const days = Math.ceil((new Date(cap.estimatedDeliveryDateAndTime) - Date.now()) / 86400000);
    if (Number.isFinite(days)) return Math.min(Math.max(days, 1), 30);
  }
  return null;
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Returns up to 2 options: [{ code, name, amountCents, minDays, maxDays }],
// cheapest first, each price = DHL rate + duties buffer, rounded up to $1.
async function quoteRates(items, destination) {
  const pkg = computePackage(items);
  if (!pkg) throw new Error('invalid items');

  const key = process.env.DHL_API_KEY;
  const secret = process.env.DHL_API_SECRET;
  const account = process.env.DHL_ACCOUNT_NUMBER;
  if (!key || !secret || !account) throw new Error('DHL API credentials not configured');

  const base = process.env.DHL_API_BASE || 'https://express.api.dhl.com/mydhlapi';
  const params = new URLSearchParams({
    accountNumber: account,
    originCountryCode: ORIGIN.countryCode,
    originCityName: ORIGIN.cityName,
    originPostalCode: ORIGIN.postalCode,
    destinationCountryCode: destination.country,
    destinationCityName: destination.city,
    weight: pkg.weightKg.toFixed(2),
    length: String(pkg.dims.length),
    width: String(pkg.dims.width),
    height: String(pkg.dims.height),
    plannedShippingDate: nextBusinessDay(),
    isCustomsDeclarable: destination.country === 'CO' ? 'false' : 'true',
    unitOfMeasurement: 'metric',
    strictValidation: 'false',
  });
  if (destination.postal) params.set('destinationPostalCode', destination.postal);

  const resp = await fetch(base + '/rates?' + params.toString(), {
    headers: {
      Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error('DHL rates error ' + resp.status + ': ' + body.slice(0, 300));
  }
  const data = await resp.json();

  const dutiesPct = destination.country === 'CO' ? 0 :
    (parseFloat(process.env.SHIPPING_DUTIES_PERCENT) || 10) / 100;
  const dutiesUsd = pkg.subtotal * dutiesPct;

  const options = [];
  for (const product of data.products || []) {
    const rateUsd = toUsd(product.totalPrice);
    if (rateUsd === null || rateUsd <= 0) continue;
    const dollars = Math.ceil(rateUsd + dutiesUsd);
    const days = transitDays(product);
    options.push({
      code: product.productCode,
      name: 'DHL ' + titleCase(product.productName || 'Express'),
      amountCents: dollars * 100,
      minDays: days ? Math.max(1, days - 1) : 3,
      maxDays: days ? days + 2 : 10,
    });
  }
  options.sort(function (a, b) { return a.amountCents - b.amountCents; });
  return options.slice(0, 2);
}

module.exports = { quoteRates, computePackage, ORIGIN };
