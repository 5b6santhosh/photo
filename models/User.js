const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  apikey: { type: String },
  avatarUrl: { type: String, default: '' },
  wins: { type: Number, default: 0 },
  bio: { type: String, default: '' },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },

});

module.exports = mongoose.model('User', UserSchema);
