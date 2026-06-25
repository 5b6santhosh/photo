/**
 * add_social_auth_tables.js
 * ─────────────────────────────────────────────────────────────
 * Non-destructive migration script for MongoDB/Mongoose.
 *
 * What it does:
 *   1. Back-fills `auth_provider = 'local'` and `is_email_verified = false`
 *      on all existing User documents that don't have these fields yet.
 *   2. Creates the SocialAccount collection and its indexes.
 *
 * SAFE TO RE-RUN: All operations are idempotent.
 *   - updateMany with $exists: false won't touch already-migrated docs.
 *   - createIndex with { background: true } is a no-op if the index exists.
 *
 * Run with:
 *   node migrations/add_social_auth_tables.js
 * ─────────────────────────────────────────────────────────────
 */

require('../config/loadEnv');
const mongoose = require('mongoose');

async function runMigration() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌  MONGO_URI is not set. Aborting migration.');
    process.exit(1);
  }

  console.log('🔗  Connecting to MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`✅  Connected to database: ${mongoose.connection.name}\n`);

  const db = mongoose.connection.db;

  // ── Step 1: Back-fill new fields on existing User documents ─────────────────
  console.log('📋  Step 1: Back-filling auth_provider + is_email_verified on users...');

  const usersCollection = db.collection('users');

  const result = await usersCollection.updateMany(
    {
      $or: [
        { auth_provider: { $exists: false } },
        { is_email_verified: { $exists: false } }
      ]
    },
    {
      $set: {
        auth_provider: 'local',
        is_email_verified: false
      }
    }
  );

  console.log(`   ✓ Updated ${result.modifiedCount} user document(s).`);
  console.log(`   ✓ ${result.matchedCount - result.modifiedCount} document(s) already up to date.\n`);

  // ── Step 2: Create SocialAccount collection indexes ──────────────────────────
  console.log('📋  Step 2: Ensuring SocialAccount collection and indexes...');

  const socialAccountsCollection = db.collection('socialaccounts');

  // Compound unique index — prevents the same social account being linked twice
  await socialAccountsCollection.createIndex(
    { provider: 1, provider_user_id: 1 },
    { unique: true, background: true }
  );
  console.log('   ✓ Index: provider + provider_user_id (unique)');

  // Index for efficient lookup of all social accounts linked to a user
  await socialAccountsCollection.createIndex(
    { user_id: 1, provider: 1 },
    { background: true }
  );
  console.log('   ✓ Index: user_id + provider');

  // Sparse index for email lookups (null values are not indexed)
  await socialAccountsCollection.createIndex(
    { email: 1 },
    { background: true, sparse: true }
  );
  console.log('   ✓ Index: email (sparse)\n');

  console.log('🎉  Migration completed successfully!\n');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Next steps:');
  console.log('  1. Add to your .env:');
  console.log('     GOOGLE_CLIENT_ID=<your_google_client_id>');
  console.log('     APPLE_BUNDLE_ID=<your_ios_bundle_id>  e.g. com.clickscurator.app');
  console.log('  2. Restart the server.');
  console.log('─────────────────────────────────────────────────────────\n');
}

runMigration()
  .catch((err) => {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
