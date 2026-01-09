const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String, required: true, unique: true, trim: true
  },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  email: {
    type: String, required: true, unique: true, lowercase: true,
    trim: true
  },
  password: { type: String, required: true },
  login_date: {
    type: Date,
    default: null
  },
  apikey: {
    type: String, default: null,
    index: true
  },
  avatarUrl: { type: String, default: '' },
  wins: { type: Number, default: 0 },
  bio: { type: String, default: '' },
  streakDays: { type: Number, default: 0 },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  countries: [{
    code: String, // "IN", "US", "DE"
    name: String
  }],
  payments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  }],
  contestsJoined: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest'
  }]

}, {
  timestamps: true
});
UserSchema.index({ contestsJoined: 1 }); // Find users in a contest
UserSchema.index({ payments: 1 });       // Find user by payment

module.exports = mongoose.model('User', UserSchema);
