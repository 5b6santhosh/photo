// const jwt = require('jsonwebtoken');
// const User = require('../models/User');

// module.exports = async function auth(req, res, next) {
//     try {
//         const token = req.headers.authorization?.split(' ')[1];
//         if (!token) return res.status(401).json({ message: 'No token' });

//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         const user = await User.findById(decoded.id).lean();

//         if (!user) return res.status(401).json({ message: 'Invalid user' });

//         req.user = {
//             id: user._id.toString(),
//             role: user.role,          // 'user' | 'admin'
//             badgeTier: user.badgeTier // newCurator | bronze | silver | gold | master
//         };

//         next();
//     } catch (e) {
//         res.status(401).json({ message: 'Auth failed' });
//     }
// };


// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const jwt = require('jsonwebtoken');

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
            id: decoded.userId,
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
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = {
                id: decoded.userId,
                email: decoded.email,
                role: decoded.role || 'user',
                badgeTier: decoded.badgeTier // newCurator | bronze | silver | gold | master
            };
        }

        next();
    } catch (error) {
        // Continue without user info
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

module.exports = {
    authMiddleware,
    optionalAuth,
    requireAdmin,
    requireJudge
};