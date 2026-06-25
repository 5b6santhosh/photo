'use strict';

/**
 * socialAuth.test.js
 * ─────────────────────────────────────────────────────────────
 * Jest test suite for the social authentication endpoints.
 *
 * Strategy: Unit tests with mocked DB models and provider services.
 * Integration-level HTTP tests use supertest against a stripped-down
 * express app — no real DB or provider calls.
 *
 * Run:
 *   npm test -- --testPathPattern=socialAuth
 * ─────────────────────────────────────────────────────────────
 */

// ── Environment setup (must happen before any require of app modules) ──────────
process.env.JWT_SECRET = 'test_jwt_secret_not_for_production';
process.env.GOOGLE_CLIENT_ID = 'test_google_client_id.apps.googleusercontent.com';
process.env.APPLE_BUNDLE_ID = 'com.clickscurator.test';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock Mongoose models — we don't want real DB calls in unit tests
jest.mock('../models/User');
jest.mock('../models/SocialAccount');

// Mock provider services — we control what "verified" tokens return
jest.mock('../services/googleAuthService');
jest.mock('../services/appleAuthService');

const User = require('../models/User');
const SocialAccount = require('../models/SocialAccount');
const { verifyGoogleToken } = require('../services/googleAuthService');
const { verifyAppleToken } = require('../services/appleAuthService');

// Build a minimal Express app for HTTP-level tests
const express = require('express');
const socialAuthRoutes = require('../routes/socialAuthRoutes');

const testApp = express();
testApp.use(express.json());
testApp.use('/api/auth', socialAuthRoutes);

const request = require('supertest');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    _id: 'user_obj_id_123',
    username: 'test_user_abc123',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    role: 'user',
    badgeTier: 'newCurator',
    auth_provider: 'google',
    is_email_verified: true,
    isProfileCompleted: false,
    avatarUrl: '',
    save: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

function makeSocialAccount(overrides = {}) {
  return {
    provider: 'google',
    provider_user_id: 'google_sub_123',
    user_id: makeUser(),
    email: 'test@example.com',
    token_expiry: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: googleAuthService unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('googleAuthService', () => {
  // Re-require the real service (not mocked) for unit tests
  let googleAuthService;

  beforeAll(() => {
    jest.unmock('../services/googleAuthService');
    googleAuthService = require('../services/googleAuthService');
  });

  afterAll(() => {
    jest.mock('../services/googleAuthService'); // restore mock for later suites
  });

  test('throws INVALID_TOKEN when idToken is missing', async () => {
    await expect(googleAuthService.verifyGoogleToken(null))
      .rejects
      .toMatchObject({ code: 'INVALID_TOKEN' });
  });

  test('throws INVALID_TOKEN when idToken is not a string', async () => {
    await expect(googleAuthService.verifyGoogleToken(12345))
      .rejects
      .toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: appleAuthService unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('appleAuthService', () => {
  let appleAuthService;

  beforeAll(() => {
    jest.unmock('../services/appleAuthService');
    appleAuthService = require('../services/appleAuthService');
  });

  afterAll(() => {
    jest.mock('../services/appleAuthService');
  });

  test('throws INVALID_TOKEN when identityToken is missing', async () => {
    await expect(appleAuthService.verifyAppleToken(undefined))
      .rejects
      .toMatchObject({ code: 'INVALID_TOKEN' });
  });

  test('throws CONFIGURATION_ERROR when APPLE_BUNDLE_ID is not set', async () => {
    const originalBundleId = process.env.APPLE_BUNDLE_ID;
    delete process.env.APPLE_BUNDLE_ID;

    await expect(appleAuthService.verifyAppleToken('sometoken'))
      .rejects
      .toMatchObject({ code: 'CONFIGURATION_ERROR' });

    process.env.APPLE_BUNDLE_ID = originalBundleId;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: POST /api/auth/google — HTTP-level tests
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/google', () => {
  const GOOGLE_PAYLOAD = {
    sub: 'google_sub_abc123',
    email: 'newuser@gmail.com',
    firstName: 'Jane',
    lastName: 'Doe',
    name: 'Jane Doe',
    picture: null,
    exp: 1893456000  // GAP 4: fixed Unix timestamp for deterministic token_expiry tests
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Test: Missing id_token ─────────────────────────────────────────────────
  test('returns 400 when id_token is missing', async () => {
    const res = await request(testApp)
      .post('/api/auth/google')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'id_token is required'
    });
  });

  // ── Test: Invalid/expired token rejection ──────────────────────────────────
  test('returns 401 when Google rejects the token', async () => {
    const err = new Error('Token expired');
    err.code = 'INVALID_TOKEN';
    verifyGoogleToken.mockRejectedValue(err);

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'expired_or_invalid_token' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: 'Invalid or expired token from provider'
    });
    expect(verifyGoogleToken).toHaveBeenCalledWith('expired_or_invalid_token');
  });

  // ── Test: Provider unreachable ─────────────────────────────────────────────
  test('returns 503 when Google servers are unreachable', async () => {
    const err = new Error('ETIMEDOUT');
    err.code = 'PROVIDER_UNREACHABLE';
    verifyGoogleToken.mockRejectedValue(err);

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'some_token' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  // ── Test: New user creation via Google (Case A) ────────────────────────────
  test('creates a new user and returns JWT when no existing account is found', async () => {
    verifyGoogleToken.mockResolvedValue(GOOGLE_PAYLOAD);

    // No existing social account
    SocialAccount.findOne.mockResolvedValue(null);
    // No existing user by email
    User.findOne.mockResolvedValue(null);
    // Successful user creation
    const newUser = makeUser({ email: GOOGLE_PAYLOAD.email, auth_provider: 'google' });
    User.create.mockResolvedValue(newUser);
    // Successful social account creation
    SocialAccount.create.mockResolvedValue({});

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'valid_google_token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_new_user).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(GOOGLE_PAYLOAD.email);
    expect(res.body.user.auth_provider).toBe('google');

    // Verify DB calls
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: GOOGLE_PAYLOAD.email,
        password: null,
        auth_provider: 'google',
        is_email_verified: true  // GAP 2: Google always sets this to true
      })
    );
    // GAP 4: SocialAccount.create must include explicit null token fields + exp-based expiry
    expect(SocialAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        provider_user_id: GOOGLE_PAYLOAD.sub,
        access_token: null,
        refresh_token: null,
        token_expiry: new Date(GOOGLE_PAYLOAD.exp * 1000)
      })
    );
  });

  // ── Test: Existing email user gets Google account linked (Case B) ──────────
  test('links Google account to existing local user when email matches', async () => {
    verifyGoogleToken.mockResolvedValue(GOOGLE_PAYLOAD);

    // No existing social account for this Google sub
    SocialAccount.findOne.mockResolvedValue(null);
    // But user exists by email (registered locally)
    const existingUser = makeUser({
      email: GOOGLE_PAYLOAD.email,
      auth_provider: 'local',
      save: jest.fn().mockResolvedValue(true)
    });
    User.findOne.mockResolvedValue(existingUser);
    // findOneAndUpdate for upsert
    SocialAccount.findOneAndUpdate.mockResolvedValue({});

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'valid_google_token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_new_user).toBe(false);
    expect(res.body.token).toBeDefined();

    // Should NOT create a new user
    expect(User.create).not.toHaveBeenCalled();
    // Should upsert a social account
    expect(SocialAccount.findOneAndUpdate).toHaveBeenCalledWith(
      { provider: 'google', provider_user_id: GOOGLE_PAYLOAD.sub },
      expect.any(Object),
      expect.objectContaining({ upsert: true })
    );
    // Should update auth_provider on user
    expect(existingUser.save).toHaveBeenCalled();
    expect(existingUser.auth_provider).toBe('google');
    expect(existingUser.is_email_verified).toBe(true);
  });

  // ── Test: Re-login via same Google account (Case C) ──────────────────────
  test('returns existing user JWT when Google social account already exists', async () => {
    verifyGoogleToken.mockResolvedValue(GOOGLE_PAYLOAD);

    const existingUser = makeUser({ email: GOOGLE_PAYLOAD.email });
    const existingSocialAccount = makeSocialAccount({
      user_id: existingUser._id,   // just the ID, not the populated doc
      save: jest.fn().mockResolvedValue(true)
    });
    // findOne returns account directly (no .populate chain)
    SocialAccount.findOne.mockResolvedValue(existingSocialAccount);
    // Controller calls User.findById for the linked user
    User.findById = jest.fn().mockResolvedValue(existingUser);

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'valid_google_token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_new_user).toBe(false);
    expect(res.body.token).toBeDefined();

    // Should NOT create anything new
    expect(User.create).not.toHaveBeenCalled();
    expect(SocialAccount.create).not.toHaveBeenCalled();
  });

  // ── Test: GAP 1 — Cross-provider conflict returns 409 ─────────────────────
  test('returns 409 when email is already linked to a different social provider', async () => {
    verifyGoogleToken.mockResolvedValue(GOOGLE_PAYLOAD);

    // No existing Google social account
    SocialAccount.findOne.mockResolvedValue(null);
    // But email belongs to an Apple-linked user
    const appleLinkedUser = makeUser({
      email: GOOGLE_PAYLOAD.email,
      auth_provider: 'apple'  // already linked to Apple — conflict!
    });
    User.findOne.mockResolvedValue(appleLinkedUser);

    const res = await request(testApp)
      .post('/api/auth/google')
      .send({ id_token: 'valid_google_token' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already linked to a apple account/i);
    expect(res.body.message).toMatch(/please sign in with apple/i);
    // Must not create any new records
    expect(User.create).not.toHaveBeenCalled();
    expect(SocialAccount.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: POST /api/auth/apple — HTTP-level tests
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/apple', () => {
  const APPLE_PAYLOAD = {
    sub: 'apple_sub_xyz789',
    email: 'user@privaterelay.appleid.com',
    exp: 1893456000  // GAP 4: fixed Unix timestamp
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Test: Missing identity_token ───────────────────────────────────────────
  test('returns 400 when identity_token is missing', async () => {
    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'identity_token is required'
    });
  });

  // ── Test: Invalid Apple token ──────────────────────────────────────────────
  test('returns 401 when Apple rejects the identity_token', async () => {
    const err = new Error('Invalid Apple identity token');
    err.code = 'INVALID_TOKEN';
    verifyAppleToken.mockRejectedValue(err);

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({ identity_token: 'bad_apple_token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── Test: Existing user linking via Apple (Case B) ─────────────────────────
  test('links Apple account to existing user when email matches', async () => {
    verifyAppleToken.mockResolvedValue(APPLE_PAYLOAD);

    SocialAccount.findOne.mockResolvedValue(null);
    const existingUser = makeUser({
      email: APPLE_PAYLOAD.email,
      auth_provider: 'local',
      save: jest.fn().mockResolvedValue(true)
    });
    User.findOne.mockResolvedValue(existingUser);
    SocialAccount.findOneAndUpdate.mockResolvedValue({});

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({
        identity_token: 'valid_apple_token',
        user: { name: { firstName: 'John', lastName: 'Appleseed' } }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_new_user).toBe(false);
    expect(User.create).not.toHaveBeenCalled();
    expect(SocialAccount.findOneAndUpdate).toHaveBeenCalledWith(
      { provider: 'apple', provider_user_id: APPLE_PAYLOAD.sub },
      expect.any(Object),
      expect.objectContaining({ upsert: true })
    );
  });

  // ── Test: New user via Apple (with name from body — first login) ────────────
  test('creates new user using name from request body on first Apple login', async () => {
    verifyAppleToken.mockResolvedValue(APPLE_PAYLOAD);

    SocialAccount.findOne.mockResolvedValue(null);
    User.findOne.mockResolvedValue(null);

    const newUser = makeUser({
      email: APPLE_PAYLOAD.email,
      firstName: 'John',
      lastName: 'Appleseed',
      auth_provider: 'apple'
    });
    User.create.mockResolvedValue(newUser);
    SocialAccount.create.mockResolvedValue({});

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({
        identity_token: 'valid_apple_token',
        user: { name: { firstName: 'John', lastName: 'Appleseed' } }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_new_user).toBe(true);

    // GAP 2: Apple relay email → is_email_verified must be FALSE
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'John',
        lastName: 'Appleseed',
        email: APPLE_PAYLOAD.email,   // from verified token, not body
        auth_provider: 'apple',
        // privaterelay.appleid.com is a relay → is_email_verified = false
        is_email_verified: false,
        password: null
      })
    );
    // GAP 4: SocialAccount.create must include explicit null token fields + exp-based expiry
    expect(SocialAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'apple',
        provider_user_id: APPLE_PAYLOAD.sub,
        access_token: null,
        refresh_token: null,
        token_expiry: new Date(APPLE_PAYLOAD.exp * 1000)
      })
    );
  });

  // ── Test: GAP 2 — Real Apple email → is_email_verified true ───────────────
  test('sets is_email_verified true when Apple email is not a relay address', async () => {
    const realEmailPayload = {
      sub: 'apple_sub_real_email',
      email: 'jane.doe@icloud.com',  // real email, not relay
      exp: 1893456000
    };
    verifyAppleToken.mockResolvedValue(realEmailPayload);

    SocialAccount.findOne.mockResolvedValue(null);
    User.findOne.mockResolvedValue(null);

    const newUser = makeUser({
      email: realEmailPayload.email,
      auth_provider: 'apple',
      is_email_verified: true
    });
    User.create.mockResolvedValue(newUser);
    SocialAccount.create.mockResolvedValue({});

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({
        identity_token: 'valid_apple_real_email_token',
        user: { name: { firstName: 'Jane', lastName: 'Doe' } }
      });

    expect(res.status).toBe(200);
    expect(res.body.is_new_user).toBe(true);
    // GAP 2: real icloud.com email → is_email_verified must be TRUE
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: realEmailPayload.email,
        is_email_verified: true
      })
    );
  });

  // ── Test: GAP 1 — Apple 409 when email already linked to Google ───────────
  test('returns 409 when Apple email is already linked to a Google account', async () => {
    verifyAppleToken.mockResolvedValue(APPLE_PAYLOAD);

    SocialAccount.findOne.mockResolvedValue(null);
    // Email belongs to a Google-linked user
    const googleLinkedUser = makeUser({
      email: APPLE_PAYLOAD.email,
      auth_provider: 'google'
    });
    User.findOne.mockResolvedValue(googleLinkedUser);

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({ identity_token: 'valid_apple_token' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already linked to a google account/i);
    expect(res.body.message).toMatch(/please sign in with google/i);
    expect(User.create).not.toHaveBeenCalled();
  });

  // ── Test: Apple re-login without email (subsequent login) ───────────────
  test('succeeds on Apple re-login where email is absent (known sub)', async () => {
    // Apple doesn't send email on re-logins — payload has no email
    verifyAppleToken.mockResolvedValue({ sub: APPLE_PAYLOAD.sub, email: null });

    const existingUser = makeUser({ auth_provider: 'apple' });
    const existingSocialAccount = makeSocialAccount({
      provider: 'apple',
      provider_user_id: APPLE_PAYLOAD.sub,
      user_id: existingUser._id,   // just the ID
      save: jest.fn().mockResolvedValue(true)
    });
    // findOne returns account directly
    SocialAccount.findOne.mockResolvedValue(existingSocialAccount);
    // Controller fetches user via findById
    User.findById = jest.fn().mockResolvedValue(existingUser);

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({ identity_token: 'valid_apple_relogin_token' });

    // Should succeed via sub lookup, not email
    expect(res.status).toBe(200);
    expect(res.body.is_new_user).toBe(false);
  });

  // ── Test: Apple first login with no email at all → 400 ─────────────────
  test('returns 400 when Apple returns no email on first login (no existing account)', async () => {
    verifyAppleToken.mockResolvedValue({ sub: 'brand_new_apple_sub', email: null });

    // No social account found
    SocialAccount.findOne.mockResolvedValue(null);
    // No user found by email (null email means User.findOne is skipped)
    User.findOne.mockResolvedValue(null);

    const res = await request(testApp)
      .post('/api/auth/apple')
      .send({ identity_token: 'valid_apple_token' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // GAP 3: message must match updated spec text
    expect(res.body.message).toMatch(/email is required for first-time apple sign-in/i);
  });
});
