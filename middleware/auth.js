// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');

const authMiddleware = async (req, res, next) => {
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

// ADD optionalAuth middleware
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            req.user = null; // No auth, but continue
            return next();
        }

        const token = authHeader.split(" ")[1];

        // Check blacklist
        const blacklisted = await TokenBlacklist.findOne({ token });
        if (blacklisted) {
            req.user = null;
            return next();
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                id: decoded.userId,
                email: decoded.email,
                role: decoded.role,
                badgeTier: decoded.badgeTier
            };
            req.token = token;
        } catch (err) {
            req.user = null; // Invalid token, but continue
        }

        next();
    } catch (err) {
        req.user = null;
        next();
    }
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
};

// Judge role check
const requireJudge = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (req.user.role !== 'judge' && req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Judge access required'
        });
    }

    next();
};

module.exports = {
    authMiddleware,
    optionalAuth,
    requireAdmin,
    requireJudge
};