// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');
const User = require('../models/User');
const { updateStreak } = require('../utils/streakUtils');

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

        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        // 🔧 NEW: Update streak if not already updated today
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const lastLogin = user.login_date ? new Date(user.login_date) : null;
        const lastLoginDate = lastLogin
            ? new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate())
            : null;

        // Only update streak if user hasn't logged in today yet
        if (!lastLoginDate || lastLoginDate.getTime() !== today.getTime()) {
            // Run streak update in background (don't block response)
            updateStreak(user).catch(err => {
                console.error('Streak update error:', err);
                // Non-fatal: don't crash auth if streak fails
            });
        }

        req.user = {
            id: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            badgeTier: decoded.badgeTier,
            streakDays: user.streakDays,
            firstName: user.firstName,
            avatarUrl: user.avatarUrl
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
            const user = await User.findById(decoded.userId);
            if (user) {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const lastLogin = user.login_date ? new Date(user.login_date) : null;
                const lastLoginDate = lastLogin
                    ? new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate())
                    : null;

                if (!lastLoginDate || lastLoginDate.getTime() !== today.getTime()) {
                    updateStreak(user).catch(err => {
                        console.error('Optional auth streak error:', err);
                    });
                }
                req.user = {
                    id: decoded.userId,
                    email: decoded.email,
                    role: decoded.role,
                    badgeTier: decoded.badgeTier,
                    streakDays: user.streakDays,
                    firstName: user.firstName,
                    avatarUrl: user.avatarUrl
                };
                req.token = token;
            } else {
                req.user = null;
            }
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