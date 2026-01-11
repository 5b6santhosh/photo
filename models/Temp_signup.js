const mongoose = require('mongoose');

const TempSignupSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },

  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },

  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },

  password: {
    type: String,
    required: true
  },

  otp: {
    type: String,        // bcrypt hash
    required: true
  },

  otpExpiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // 🔥 auto-delete expired records
  },

  login_date: {
    type: Date,
    default: null
  },

  apikey: {
    type: String,
    default: null,
    index: true
  },

  avatarUrl: { type: String, default: '' },
  wins: { type: Number, default: 0 },
  bio: { type: String, default: '' },
  streakDays: { type: Number, default: 0 },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },

  countries: [{
    code: String,
    name: String
  }],

  payments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  }],

  contestsJoined: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest'
  }],

  isActive: {
    type: Number,
    enum: [0, 1],
    default: 1
  }

}, {
  timestamps: true
});

// indexes
TempSignupSchema.index({ contestsJoined: 1 });
TempSignupSchema.index({ payments: 1 });

module.exports = mongoose.model('Tempusers', TempSignupSchema);
