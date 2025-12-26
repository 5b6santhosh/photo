// models/Submission.js
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest',
    required: true
  },

  // Link to FileMeta for file management
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FileMeta',
    required: true
  },

  // Your original fields
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
  // mediaUrl: {
  //   type: String,
  //   required: true
  // },
  // thumbnailUrl: {
  //   type: String
  // },

  // Status from Contest model
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'shortlisted', 'winner'],
    default: 'pending'
  },

  caption: {
    type: String,
    maxlength: 500
  },

  submittedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});
// 1 submission per user per contest
submissionSchema.index({ userId: 1, contestId: 1 }, { unique: true });

// Update timestamp on save
submissionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Submission', submissionSchema);