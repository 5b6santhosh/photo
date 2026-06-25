'use strict';

/**
 * appleAuthService.js
 * ─────────────────────────────────────────────────────────────
 * Verifies an Apple identity_token server-side.
 *
 * Apple does NOT provide a simple tokeninfo endpoint like Google.
 * Instead, we must:
 *   1. Fetch Apple's public JWKS from https://appleid.apple.com/auth/keys
 *   2. Match the `kid` in the token header to a key in the JWKS
 *   3. Reconstruct the RSA public key from (n, e) components
 *   4. Verify the JWT signature using jsonwebtoken (already installed)
 *   5. Validate iss, aud, exp claims manually
 *
 * JWKS are cached in-memory for 1 hour to avoid hammering Apple's servers
 * on every request while still refreshing regularly.
 *
 * Throws a typed Error with a `code` property so the controller
 * can map it to the right HTTP status.
 * ─────────────────────────────────────────────────────────────
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-memory JWKS cache
let jwksCache = {
  keys: null,
  fetchedAt: 0
};

/**
 * Fetch Apple's JWKS, using the in-memory cache when fresh.
 * @returns {Promise<Array>} Array of JWK objects
 */
async function getApplePublicKeys() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  let response;
  try {
    response = await axios.get(APPLE_KEYS_URL, { timeout: 5000 });
  } catch (axiosErr) {
    const err = new Error('Unable to reach Apple auth servers. Please try again.');
    err.code = 'PROVIDER_UNREACHABLE';
    throw err;
  }

  const keys = response.data?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    const err = new Error('Invalid JWKS response from Apple');
    err.code = 'PROVIDER_UNREACHABLE';
    throw err;
  }

  jwksCache = { keys, fetchedAt: now };
  return keys;
}

/**
 * Convert a Base64URL-encoded big integer (from JWKS n/e fields)
 * to a Buffer suitable for crypto key construction.
 */
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

/**
 * Build an RSA public key PEM string from a JWK object.
 * Uses Node's built-in crypto — no extra dependencies.
 *
 * @param {{ n: string, e: string, kty: string }} jwk
 * @returns {string} PEM-formatted RSA public key
 */
function jwkToPem(jwk) {
  const publicKey = crypto.createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e
    },
    format: 'jwk'
  });
  return publicKey.export({ type: 'spki', format: 'pem' });
}

/**
 * Decode the JWT header without verification to extract `kid` and `alg`.
 *
 * @param {string} token
 * @returns {{ kid: string, alg: string }}
 */
function decodeTokenHeader(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    const err = new Error('Malformed Apple identity token');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return header;
  } catch {
    const err = new Error('Could not decode Apple token header');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
}

/**
 * Verify an Apple identity_token and return a normalised user payload.
 *
 * @param {string} identityToken - The identity_token from Apple Sign In
 * @returns {Promise<{ sub: string, email: string|null }>}
 * @throws {Error} with .code = 'INVALID_TOKEN' | 'PROVIDER_UNREACHABLE' | 'CONFIGURATION_ERROR'
 */
async function verifyAppleToken(identityToken) {
  if (!identityToken || typeof identityToken !== 'string') {
    const err = new Error('identity_token must be a non-empty string');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  if (!process.env.APPLE_BUNDLE_ID) {
    const err = new Error('APPLE_BUNDLE_ID environment variable is not set');
    err.code = 'CONFIGURATION_ERROR';
    throw err;
  }

  // 1. Decode header to find which Apple key was used to sign this token
  const header = decodeTokenHeader(identityToken);

  // 2. Fetch Apple's public keys (cached)
  const appleKeys = await getApplePublicKeys();

  // 3. Find the matching key by kid
  const matchingKey = appleKeys.find((k) => k.kid === header.kid);
  if (!matchingKey) {
    // kid not found → likely a cached stale JWKS; force a refresh once
    jwksCache = { keys: null, fetchedAt: 0 };
    const freshKeys = await getApplePublicKeys();
    const retryKey = freshKeys.find((k) => k.kid === header.kid);
    if (!retryKey) {
      const err = new Error('Apple public key not found for this token');
      err.code = 'INVALID_TOKEN';
      throw err;
    }
  }

  const jwk = matchingKey || appleKeys.find((k) => k.kid === header.kid);

  // 4. Build PEM from JWK
  let pem;
  try {
    pem = jwkToPem(jwk);
  } catch {
    const err = new Error('Failed to construct Apple public key');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  // 5. Verify JWT signature, expiry, issuer, and audience
  let payload;
  try {
    payload = jwt.verify(identityToken, pem, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: process.env.APPLE_BUNDLE_ID
    });
  } catch (jwtErr) {
    if (jwtErr.name === 'TokenExpiredError') {
      const err = new Error('Apple identity token has expired');
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    const err = new Error('Invalid Apple identity token');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  // 6. Return normalised payload
  // NOTE: Apple only sends email on the FIRST login. On subsequent logins,
  //       email will be undefined. The controller handles this by using the
  //       stored email from the social_accounts table.
  return {
    sub: payload.sub,                     // Apple's unique user ID — stable across logins
    email: payload.email || null,         // May be null on re-login or with private relay
    exp: payload.exp || null              // GAP 4: Unix timestamp (seconds) for token_expiry storage
  };
}

// Exported for testing (allows cache invalidation in tests)
function _clearJwksCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
}

module.exports = { verifyAppleToken, _clearJwksCache };
