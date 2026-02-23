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
  location: {
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    countryCode: { type: String, default: '' },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    source: { type: String, default: null },
    lastUpdated: { type: Date, default: null }
  },
  isProfileCompleted: {
    type: Boolean,
    default: false
  },
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
  }],
  isActive: {
    type: Number,
    enum: [0, 1],
    default: 1,   // 1 = active
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'judge'],
    default: 'user'
  },
  badgeTier: {
    type: String,
    default: 'newCurator'
  },
  dateOfBirth: {
    type: Date,
    default: null
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: null
  },
}, {
  timestamps: true,

});
UserSchema.index({ contestsJoined: 1 }); // Find users in a contest
UserSchema.index({ payments: 1 });       // Find user by payment
UserSchema.index({ 'location.country': 1 }); // Find users by country
UserSchema.index({ 'location.city': 1 });    // Find users by city
UserSchema.index({ 'location.countryCode': 1 });

module.exports = mongoose.model('User', UserSchema);
