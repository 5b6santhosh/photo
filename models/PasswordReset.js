const mongoose = require('mongoose');

const PasswordResetSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    lowercase: true, 
    trim: true,
    index: true 
  },
  otp: { type: String, required: true },
  otpExpiresAt: { type: Date, required: true },
  otpAttempts: { type: Number, default: 0 },
  lastOtpSentAt: { type: Date }
}, { timestamps: true });

// Auto-delete expired records after 5 minutes
PasswordResetSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 });
PasswordResetSchema.index({ email: 1, lastOtpSentAt: -1 });

module.exports = mongoose.model('PasswordReset', PasswordResetSchema);