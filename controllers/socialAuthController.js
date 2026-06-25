'use strict';

/**
 * socialAuthController.js
 * ─────────────────────────────────────────────────────────────
 * Handles POST /auth/google and POST /auth/apple.
 *
 * Both endpoints share the same core logic via handleSocialAuth():
 *
 *   Case A — Brand-new user:
 *     Verify token → extract payload → create User (no password) →
 *     create SocialAccount → return JWT
 *
 *   Case B — Existing user (matched by email):
 *     Verify token → find user by email → upsert SocialAccount →
 *     return JWT (same structure as /auth/login)
 *
 *   Case C — Re-login via same social provider:
 *     Verify token → find SocialAccount by (provider, sub) → 
 *     update tokens → return JWT
 *
 * Priority of matching (to prevent duplicate users):
 *   1. provider_user_id match in social_accounts  (fastest path, re-login)
 *   2. email match in users table                 (account linking)
 *   3. Neither found → create new user
 *
 * SECURITY: Email is ALWAYS taken from the verified token payload —
 *           never from the client request body.
 * ─────────────────────────────────────────────────────────────
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SocialAccount = require('../models/SocialAccount');
const { verifyGoogleToken } = require('../services/googleAuthService');
const { verifyAppleToken } = require('../services/appleAuthService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map a service error code to an HTTP status + user-facing message.
 */
function errorResponse(code, defaultMessage) {
  const map = {
    INVALID_TOKEN: { status: 401, message: 'Invalid or expired token from provider' },
    EMAIL_NOT_VERIFIED: { status: 401, message: 'Email not verified with provider' },
    PROVIDER_UNREACHABLE: { status: 503, message: 'Unable to reach authentication provider. Please try again.' },
    CONFIGURATION_ERROR: { status: 500, message: 'Server authentication is not configured correctly. Contact support.' },
    PROVIDER_CONFLICT: { status: 409, message: 'Account already linked to a different provider' }
  };
  return map[code] || { status: 500, message: defaultMessage || 'Authentication failed. Please try again.' };
}

// GAP 2 helper — Apple private relay addresses are not considered verified emails
const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';
function isEmailVerifiedForProvider(provider, email) {
  if (provider === 'google') return true; // Google guarantees email_verified in payload
  if (provider === 'apple') {
    // Apple relay addresses are proxies — treat as unverified
    return !!(email && !email.toLowerCase().endsWith(APPLE_RELAY_DOMAIN));
  }
  return false;
}

// GAP 4 helper — convert Unix `exp` seconds to a Date (or fall back to 7 days)
function expToDate(exp) {
  if (exp && typeof exp === 'number') return new Date(exp * 1000);
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Generate a unique username from a social provider's name fields.
 * Format: firstname_lastname_XXXXXX (6 random alphanumeric chars)
 * Falls back to "user_XXXXXX" if no name is available.
 */
function generateUsername(firstName, lastName) {
  const random = Math.random().toString(36).substring(2, 8); // 6 chars
  const base = [firstName, lastName]
    .filter(Boolean)
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '') // strip non-alphanum chars
    .substring(0, 20);           // cap to avoid overly long usernames
  return base ? `${base}_${random}` : `user_${random}`;
}

/**
 * Sign a JWT with the same structure and expiry as the existing /auth/login endpoint.
 */
function signJwt(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      role: user.role || 'user',
      badgeTier: user.badgeTier || 'newCurator'
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Build the sanitised user object returned in every social auth response.
 * Mirrors the structure used in /auth/login for consistency.
 */
function buildUserResponse(user) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
    role: user.role,
    badgeTier: user.badgeTier,
    auth_provider: user.auth_provider,
    is_email_verified: user.is_email_verified,
    isProfileCompleted: user.isProfileCompleted,
    avatarUrl: user.avatarUrl
  };
}

// ─── Core Social Auth Logic ───────────────────────────────────────────────────

/**
 * Shared handler for both Google and Apple sign-in flows.
 *
 * @param {'google'|'apple'} provider
 * @param {{ sub: string, email: string|null, firstName?: string, lastName?: string, name?: string }} payload
 * @returns {Promise<{ token: string, user: object, is_new_user: boolean }>}
 */
async function handleSocialAuth(provider, payload) {
  const { sub, email, firstName = '', lastName = '', name = '', exp } = payload;

  // ── Priority 1: Check if this exact social account already exists ──────────
  let socialAccount = await SocialAccount.findOne({
    provider,
    provider_user_id: sub
  });

  if (socialAccount) {
    // Fetch the linked user separately (two-step avoids .populate() chain issues)
    const user = await User.findById(socialAccount.user_id);

    if (user) {
      // Update stored email if Apple now returned one (they may not on every login)
      if (email && !socialAccount.email) {
        socialAccount.email = email;
      }
      // GAP 4: use token's own exp claim for accurate expiry
      socialAccount.token_expiry = expToDate(exp);
      await socialAccount.save();

      return {
        token: signJwt(user),
        user: buildUserResponse(user),
        is_new_user: false
      };
    }
  }

  // ── Priority 2: Match by email → link this social account to existing user ──
  // GUARD: never query MongoDB with { email: null } — it matches docs with no email field
  if (email) {
    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      // GAP 1 — Cross-provider conflict detection:
      // If the existing user is already linked to a DIFFERENT social provider,
      // refuse silently linking — force them to use their original provider.
      if (
        existingUser.auth_provider !== 'local' &&
        existingUser.auth_provider !== provider
      ) {
        const err = new Error(
          `This email is already linked to a ${existingUser.auth_provider} account. ` +
          `Please sign in with ${existingUser.auth_provider} instead.`
        );
        err.code = 'PROVIDER_CONFLICT';
        throw err;
      }

      // GAP 4: upsert with explicit null token fields + exp-based expiry
      await SocialAccount.findOneAndUpdate(
        { provider, provider_user_id: sub },
        {
          $setOnInsert: { created_at: new Date() },
          $set: {
            user_id: existingUser._id,
            email,
            access_token: null,
            refresh_token: null,
            token_expiry: expToDate(exp)
          }
        },
        { upsert: true, new: true }
      );

      // Upgrade auth_provider if user was previously local-only
      if (existingUser.auth_provider === 'local') {
        existingUser.auth_provider = provider;
        existingUser.is_email_verified = true;
        await existingUser.save();
      }

      return {
        token: signJwt(existingUser),
        user: buildUserResponse(existingUser),
        is_new_user: false
      };
    }
  }

  // ── Priority 3: No match → create a brand-new user ────────────────────────

  // GAP 3: Apple may not send email on re-login — Priority 1 already handles the
  // known-sub re-login case above. If we reach here with no email, it means this
  // is a genuinely first-time login with no retrievable email → unrecoverable.
  if (!email) {
    const err = new Error(
      provider === 'apple'
        ? 'Email is required for first-time Apple sign-in. Please ensure your Apple ID has a verified email.'
        : 'Could not retrieve email from provider.'
    );
    err.code = 'EMAIL_REQUIRED';
    throw err;
  }

  // Derive name parts (Apple sends firstName/lastName in request body on first login)
  const derivedFirstName = firstName || (name ? name.split(' ')[0] : '');
  const derivedLastName = lastName || (name ? name.split(' ').slice(1).join(' ') : '');

  // Generate a unique username (user can update it later via /profile)
  let username = generateUsername(derivedFirstName, derivedLastName);
  // Guarantee uniqueness — retry once if collision
  const collision = await User.findOne({ username });
  if (collision) {
    username = generateUsername(derivedFirstName, derivedLastName);
  }

  const newUser = await User.create({
    username,
    firstName: derivedFirstName,
    lastName: derivedLastName,
    email: email.toLowerCase(),
    password: null,               // Social users have no password
    auth_provider: provider,
    // GAP 2: Google always verifies; Apple relay addresses are not considered verified
    is_email_verified: isEmailVerifiedForProvider(provider, email),
    isActive: 1,
    badgeTier: 'newCurator',
    role: 'user'
  });

  // GAP 4: explicit null for token fields; exp-based expiry
  await SocialAccount.create({
    user_id: newUser._id,
    provider,
    provider_user_id: sub,
    email,
    access_token: null,
    refresh_token: null,
    token_expiry: expToDate(exp)
  });

  return {
    token: signJwt(newUser),
    user: buildUserResponse(newUser),
    is_new_user: true
  };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * POST /auth/google
 * Body: { "id_token": "string" }
 */
async function googleAuth(req, res) {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({
        success: false,
        message: 'id_token is required'
      });
    }

    // SECURITY: verify server-side — never trust client-supplied user data
    const payload = await verifyGoogleToken(id_token);

    const result = await handleSocialAuth('google', payload);

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    // Never log the id_token itself
    console.error('[GoogleAuth] Error:', err.message, '| code:', err.code);

    if (err.code === 'EMAIL_REQUIRED') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.code === 'PROVIDER_CONFLICT') {
      return res.status(409).json({ success: false, message: err.message });
    }

    const { status, message } = errorResponse(err.code, err.message);
    return res.status(status).json({ success: false, message });
  }
}

/**
 * POST /auth/apple
 * Body: {
 *   "identity_token": "string",
 *   "user": { "name": { "firstName": "", "lastName": "" } }  // optional, first login only
 * }
 */
async function appleAuth(req, res) {
  try {
    const { identity_token, user: appleUserObj } = req.body;

    if (!identity_token) {
      return res.status(400).json({
        success: false,
        message: 'identity_token is required'
      });
    }

    // SECURITY: verify server-side — email comes from the verified payload, not the body
    const payload = await verifyAppleToken(identity_token);

    // Apple only sends name on the FIRST sign-in; we must capture it from the body
    // On subsequent logins, appleUserObj will be absent — that's fine.
    const firstName = appleUserObj?.name?.firstName || '';
    const lastName = appleUserObj?.name?.lastName || '';

    const result = await handleSocialAuth('apple', {
      ...payload,
      firstName,
      lastName
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    // Never log the identity_token itself
    console.error('[AppleAuth] Error:', err.message, '| code:', err.code);

    if (err.code === 'EMAIL_REQUIRED') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.code === 'PROVIDER_CONFLICT') {
      return res.status(409).json({ success: false, message: err.message });
    }

    const { status, message } = errorResponse(err.code, err.message);
    return res.status(status).json({ success: false, message });
  }
}

module.exports = { googleAuth, appleAuth };
