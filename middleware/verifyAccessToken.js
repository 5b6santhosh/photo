const TokenBlacklist = require('../models/TokenBlacklist');

exports.authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const token = authHeader.split(" ")[1];

        const blacklisted = await TokenBlacklist.findOne({ token });
        if (blacklisted) {
            return res.status(401).json({ message: "Token expired. Please login again." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = {
            id: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            badgeTier: decoded.badgeTier
        };

        req.token = token;

        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};
