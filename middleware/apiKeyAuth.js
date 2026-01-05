const User = require('../models/User');

module.exports = async function apiKeyAuth(req, res, next) {
  try {
    const apiKey = req.header('x-api-key');

    if (!apiKey) {
      return res.status(401).json({ message: 'API key missing' });
    }

    const user = await User.findOne({ apikey: apiKey }).select('-password');

    if (!user) {
      return res.status(403).json({ message: 'Invalid API key' });
    }

    // ❌ login_date missing
    if (!user.login_date) {
      return res.status(401).json({
        message: 'Login required. No login date found.'
      });
    }

    // ✅ Check login_date within last 20 days
    const now = new Date();
    const loginDate = new Date(user.login_date);

    const diffInDays =
      (now.getTime() - loginDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffInDays > 20) {
      return res.status(401).json({
        message: 'API key expired. Please login again.',
        lastLogin: user.login_date
      });
    }

    req.user = user;
    next();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
