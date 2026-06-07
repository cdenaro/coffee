module.exports = function handler(req, res) {
  var key = process.env.STRIPE_SECRET_KEY || '(not set)';
  var prefix = key.length > 8 ? key.substring(0, 8) + '...' : key;
  res.status(200).json({ key_prefix: prefix, length: key.length });
};
