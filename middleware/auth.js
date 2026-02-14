
// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const authMiddleware = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'No authentication token provided'
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach user info to request
        req.user = {
            id: decoded.userId.toString(),
            email: decoded.email,
            role: decoded.role || 'user',
            badgeTier: decoded.badgeTier // newCurator | bronze | silver | gold | master
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token has expired'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
        return res.status(401).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

// Optional auth - doesn't fail if no token
// const optionalAuth = async (req, res, next) => {
//     try {
//         const authHeader = req.headers.authorization;

//         if (authHeader && authHeader.startsWith('Bearer ')) {
//             const token = authHeader.substring(7);
//             const decoded = jwt.verify(token, process.env.JWT_SECRET);

//             req.user = {
//                 id: decoded.userId,
//                 email: decoded.email,
//                 role: decoded.role || 'user',
//                 badgeTier: decoded.badgeTier // newCurator | bronze | silver | gold | master
//             };
//         }

//         next();
//     } catch (error) {
//         // Continue without user info
//         next();
//     }
// };
const optionalAuth = async (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('Authorization')?.replace('Bearer ', '') ||
            req.header('x-auth-token') ||
            req.query.token;

        if (!token) {
            return next();
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach user to req object
        const user = await User.findById(decoded.userId).select('-password');
        req.user = user;

        next();
    } catch (err) {
        // Invalid token - continue as guest
        console.warn('Invalid optional token:', err.message);
        next();
    }
};

// Admin role check
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'judge') {
        return res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
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
// const apiKeyAuth = require('./apiKeyAuth');

module.exports = {
    authMiddleware,
    // apiKeyAuth,
    optionalAuth,
    requireAdmin,
    requireJudge
};