const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token:     { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date,   required: true, index: { expireAfterSeconds: 0 } },
});

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
