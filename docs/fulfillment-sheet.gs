/**
 * Point of Origin Coffee — fulfillment sheet receiver.
 *
 * Paste this into the Apps Script editor of the fulfillment Google Sheet
 * (Extensions → Apps Script), set TOKEN below, then deploy:
 * Deploy → New deployment → Web app → Execute as: Me →
 * Who has access: Anyone → Deploy, and copy the web app URL into the
 * FULFILLMENT_SHEET_URL env var in Vercel (and this TOKEN into
 * FULFILLMENT_SHEET_TOKEN). Full steps: docs/ORDERS-SETUP.md.
 *
 * Each paid order arrives as a new row with Status "NEW". Fulfillment
 * workflow: set Status to SHIPPED (fill Shipped Date + Tracking) when it
 * goes out, and RECEIVED (fill Received Date) when it arrives.
 */

// Shared secret — must match FULFILLMENT_SHEET_TOKEN in Vercel.
// Replace with any long random string (e.g. from https://www.uuidgenerator.net/).
var TOKEN = 'CHANGE-ME';

var HEADERS = [
  'Order Date', 'Order ID', 'Customer', 'Email', 'Items',
  'Shipping $', 'Total $', 'Ship To', 'Country', 'Order Notes',
  'Stripe Link', 'Status', 'Shipped Date', 'Tracking #', 'Received Date',
];

function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ error: 'bad json' });
  }
  if (!payload || payload.token !== TOKEN || !payload.order) {
    return out({ error: 'unauthorized' });
  }
  var order = payload.order;

  // Serialize concurrent writes (Stripe can retry/deliver in parallel).
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // Create the header row on first use.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Dedupe on Order ID (column B) so webhook retries don't double-log.
    if (sheet.getLastRow() > 1) {
      var ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] === order.id) {
          return out({ status: 'ok', deduped: true });
        }
      }
    }

    sheet.appendRow([
      order.date, order.id, order.customer, order.email, order.items,
      order.shipping, order.total, order.address, order.country,
      order.notes, order.payment_url, 'NEW', '', '', '',
    ]);

    // Status dropdown on the new row.
    var row = sheet.getLastRow();
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['NEW', 'SHIPPED', 'RECEIVED', 'CANCELED'], true)
      .build();
    sheet.getRange(row, 12).setDataValidation(rule);

    return out({ status: 'ok' });
  } finally {
    lock.releaseLock();
  }
}
