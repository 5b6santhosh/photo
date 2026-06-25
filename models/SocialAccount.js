const mongoose = require('mongoose');

/**
 * SocialAccount — links a User to their social provider identity.
 *
 * One user can have multiple social accounts (e.g. Google + Apple).
 * Compound unique index on (provider, provider_user_id) prevents duplicates.
 */
const SocialAccountSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['google', 'apple'],
      required: true
    },
    provider_user_id: {
      type: String,
      required: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null
    },
    // Store only what's necessary; NEVER log these in plaintext
    access_token: {
      type: String,
      default: null,
      select: false  // excluded from queries by default for security
    },
    refresh_token: {
      type: String,
      default: null,
      select: false
    },
    token_expiry: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

// Prevents the same social account from being linked twice
SocialAccountSchema.index({ provider: 1, provider_user_id: 1 }, { unique: true });
// Efficient lookup: "all social accounts for this user"
SocialAccountSchema.index({ user_id: 1, provider: 1 });

module.exports = mongoose.model('SocialAccount', SocialAccountSchema);
