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
submissionSchema.index({ contestId: 1, userId: 1 }); // Fast: "Get my submissions for contest X"
submissionSchema.index({ fileId: 1 }); // Fast: "Find submission by file"

// Update timestamp on save
submissionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Submission', submissionSchema);