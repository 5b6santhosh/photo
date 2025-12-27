const User = require('../models/User');

module.exports = async function apiKeyAuth(req, res, next) {
  try {
    const apiKey = req.header('x-api-key');

    if (!apiKey) {
      return res.status(401).json({ message: 'API key missing' });
    }

    // Find user directly by apiKey (FAST & CORRECT)
    const user = await User.findOne({ apikey: apiKey }).select('-password');

    if (!user) {
      return res.status(403).json({ message: 'Invalid API key' });
    }

    req.user = user; // attach authenticated user
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
