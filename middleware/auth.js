const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function auth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'No token' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).lean();

        if (!user) return res.status(401).json({ message: 'Invalid user' });

        req.user = {
            id: user._id.toString(),
            role: user.role,          // 'user' | 'admin'
            badgeTier: user.badgeTier // newCurator | bronze | silver | gold | master
        };

        next();
    } catch (e) {
        res.status(401).json({ message: 'Auth failed' });
    }
};
