const mongoose = require('mongoose');
const { Schema } = mongoose;

const deviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      sparse: true
    },
    deviceType: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true,
      index: true
    },
    deviceName: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    invalidatedAt: {
      type: Date,
      default: null
    },
    invalidReason: {
      type: String,
      enum: ['UNREGISTERED', 'INVALID_ARGUMENT', 'MISMATCHED_CREDENTIAL', 'NOT_FOUND', null],
      default: null
    },
    lastUsedAt: {
      type: Date,
      default: () => new Date(),
      index: true
    },
    fcmResponseMetadata: {
      messageId: { type: String, default: null },
      lastSyncedAt: { type: Date, default: null }
    }
  },
  {
    timestamps: true
  }
);

// TTL index: Auto-delete inactive tokens after 90 days
deviceTokenSchema.index(
  { invalidatedAt: 1 },
  {
    expireAfterSeconds: 7776000, // 90 days
    sparse: true
  }
);

// ============================================================================
// INSTANCE METHODS
// ============================================================================

deviceTokenSchema.methods.invalidate = async function (reason = 'UNREGISTERED') {
  this.isActive = false;
  this.invalidatedAt = new Date();
  this.invalidReason = reason;
  return this.save();
};

deviceTokenSchema.methods.markAsUsed = async function () {
  this.lastUsedAt = new Date();
  return this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

deviceTokenSchema.statics.findActiveByUserId = async function (userId) {
  return this.find({ userId, isActive: true });
};

deviceTokenSchema.statics.findByToken = async function (token) {
  return this.findOne({ token, isActive: true });
};

deviceTokenSchema.statics.invalidateByToken = async function (token, reason) {
  return this.updateOne(
    { token },
    {
      isActive: false,
      invalidatedAt: new Date(),
      invalidReason: reason
    }
  );
};

deviceTokenSchema.statics.cleanupInvalidTokens = async function (staleDays = 90) {
  const staleDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const result = await this.deleteMany({
    isActive: false,
    invalidatedAt: { $lt: staleDate }
  });
  return {
    deletedCount: result.deletedCount || 0
  };
};

// ============================================================================
// COMPOUND INDEXES FOR COMMON QUERIES
// ============================================================================

deviceTokenSchema.index({ userId: 1, isActive: 1, deviceType: 1 });
deviceTokenSchema.index({ isActive: 1, lastUsedAt: 1 });
deviceTokenSchema.index({ invalidatedAt: 1, isActive: 1 });

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

module.exports = DeviceToken;
