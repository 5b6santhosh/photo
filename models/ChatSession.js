const mongoose = require('mongoose');
const { Schema } = mongoose;

const chatMessageSchema = new Schema({
  role: {
    type: String,
    enum: ['user', 'model'],
    required: true
  },
  text: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const chatSessionSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    messages: [chatMessageSchema]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('ChatSession', chatSessionSchema);
