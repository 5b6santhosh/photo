'use strict';

/**
 * googleAuthService.js
 * ─────────────────────────────────────────────────────────────
 * Verifies a Google id_token server-side using google-auth-library.
 * The library is already a project dependency — no new installs needed.
 *
 * Flow:
 *   1. Call OAuth2Client.verifyIdToken() — this hits Google's certs endpoint
 *      to verify the RSA signature, expiry, and audience claim.
 *   2. Assert email_verified === true.
 *   3. Return a normalised payload object.
 *
 * Throws a typed Error with a `code` property so the controller
 * can map it to the right HTTP status.
 * ─────────────────────────────────────────────────────────────
 */

const { OAuth2Client } = require('google-auth-library');

// Lazily initialise client so missing env vars don't crash the server on boot
let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      const err = new Error('GOOGLE_CLIENT_ID environment variable is not set');
      err.code = 'CONFIGURATION_ERROR';
      throw err;
    }
    _client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return _client;
}

/**
 * Verify a Google id_token and return a normalised user payload.
 *
 * @param {string} idToken - The id_token received from the client
 * @returns {Promise<{ sub: string, email: string, firstName: string, lastName: string, name: string, picture: string|null }>}
 * @throws {Error} with .code = 'INVALID_TOKEN' | 'EMAIL_NOT_VERIFIED' | 'PROVIDER_UNREACHABLE'
 */
async function verifyGoogleToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const err = new Error('id_token must be a non-empty string');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  let ticket;
  try {
    const client = getClient();
    ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
  } catch (libErr) {
    // Distinguish network/timeout errors from bad tokens
    const isNetworkError =
      libErr.message?.includes('ETIMEDOUT') ||
      libErr.message?.includes('ECONNREFUSED') ||
      libErr.message?.includes('ENOTFOUND') ||
      libErr.message?.includes('fetch');

    if (isNetworkError) {
      const err = new Error('Unable to reach Google auth servers. Please try again.');
      err.code = 'PROVIDER_UNREACHABLE';
      throw err;
    }

    // Everything else (expired, bad sig, wrong audience) → invalid token
    const err = new Error('Invalid or expired Google token');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  const payload = ticket.getPayload();

  // SECURITY: Never trust the client's claimed email — always use the verified payload
  if (!payload.email_verified) {
    const err = new Error('Email not verified with Google');
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }

  return {
    sub: payload.sub,           // Google's unique user ID (provider_user_id)
    email: payload.email,       // Verified email from Google — not from client body
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
    name: payload.name || '',
    picture: payload.picture || null,
    exp: payload.exp || null    // GAP 4: Unix timestamp (seconds) for token_expiry storage
  };
}

module.exports = { verifyGoogleToken };
