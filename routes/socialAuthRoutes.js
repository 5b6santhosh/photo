'use strict';

/**
 * socialAuthRoutes.js
 * ─────────────────────────────────────────────────────────────
 * Mounts POST /google and POST /apple under /api/auth.
 *
 * Rate limiting mirrors the spirit of the existing /api/auth routes:
 *   10 requests per 15 minutes per IP.
 *
 * This file is completely self-contained — it does NOT modify or
 * import from the existing auth.js route file.
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { googleAuth, appleAuth } = require('../controllers/socialAuthController');

const router = express.Router();

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
// Same philosophy as the existing auth rate limiter in server.js:
// generous enough for real users, strict enough to stop brute-force.
const socialAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication requests. Please try again in 15 minutes.'
  },
  // Skip rate limiting in tests / development if needed
  skip: (req) => process.env.NODE_ENV === 'test'
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/google
 * Body: { "id_token": "string" }
 * Response: { "success": true, "token": "jwt", "user": {...}, "is_new_user": bool }
 */
router.post('/google', socialAuthLimiter, googleAuth);

/**
 * POST /api/auth/apple
 * Body: {
 *   "identity_token": "string",
 *   "user": { "name": { "firstName": "...", "lastName": "..." } }  // optional
 * }
 * Response: { "success": true, "token": "jwt", "user": {...}, "is_new_user": bool }
 */
router.post('/apple', socialAuthLimiter, appleAuth);

module.exports = router;
