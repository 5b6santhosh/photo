// models/Submission.js - FIXED VERSION
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  contestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest',
    required: true,
    index: true
  },

  // Link to FileMeta for file management
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FileMeta',
    required: true,
    index: true
  },

  // FIXED: Not required for free contests
  contestEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContestEntry',
    required: false, // Free contests don't have ContestEntry
    default: null
  },

  // Media type
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },

  // Submission status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'shortlisted', 'winner', 'disqualified', 'review'],
    default: 'pending',
    index: true
  },

  verdict: {
    type: String,
    enum: ['approved', 'rejected', 'review', 'error', 'pending'],
    default: 'pending'
  },


  // Caption/description
  caption: {
    type: String,
    maxlength: 2000, // Increased from 500 for better descriptions
    trim: true,
    default: ''
  },

  // Status metadata
  approvedAt: {
    type: Date,
    default: null
  },

  rejectedAt: {
    type: Date,
    default: null
  },

  rejectionReason: {
    type: String,
    maxlength: 500,
    default: null
  },

  // Admin who approved/rejected
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Voting/engagement metrics
  votes: {
    type: Number,
    default: 0,
    min: 0
  },

  views: {
    type: Number,
    default: 0,
    min: 0
  },

  // Prize/ranking info (for winners)
  prizePosition: {
    type: Number,
    default: null,
    min: 1
  },

  prizeAmount: {
    type: Number,
    default: null,
    min: 0
  },
  mediaUrl: { type: String, default: null },
  thumbnailUrl: { type: String, default: null },
  cloudinaryPublicId: { type: String, default: null },
  caption: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
  aiScore: { type: Number, min: 0, max: 100 },
  submittedAt: { type: Date, default: Date.now },
  evaluatedAt: { type: Date },



  // Metadata
  metadata: {
    fileSize: Number,
    duration: Number, // For videos
    dimensions: {
      width: Number,
      height: Number
    },
    deviceInfo: String
  }

}, {
  timestamps: true // FIXED: Use Mongoose timestamps instead of manual
});

// ============================================================================
// INDEXES
// ============================================================================

// FIXED: Unique constraint - One submission per user per contest
submissionSchema.index(
  { contestId: 1, userId: 1 },
  { unique: true }
);

// Query optimization indexes
submissionSchema.index({ contestId: 1, status: 1 }); // Get all approved submissions
submissionSchema.index({ userId: 1, status: 1 }); // Get user's approved submissions
submissionSchema.index({ status: 1, createdAt: -1 }); // Admin review queue
submissionSchema.index({ contestId: 1, votes: -1 }); // Leaderboard sorting

// ============================================================================
// VIRTUAL FIELDS
// ============================================================================

// Virtual for submission age
submissionSchema.virtual('age').get(function () {
  return Date.now() - this.createdAt;
});

// Virtual for review status
submissionSchema.virtual('isReviewed').get(function () {
  return ['approved', 'rejected', 'shortlisted', 'winner', 'disqualified'].includes(this.status);
});

// ============================================================================
// METHODS
// ============================================================================

/**
 * Approve submission
 */
submissionSchema.methods.approve = async function (reviewerId) {
  this.status = 'approved';
  this.approvedAt = new Date();
  this.reviewedBy = reviewerId;
  this.rejectedAt = null;
  this.rejectionReason = null;
  return this.save();
};

/**
 * Reject submission
 */
submissionSchema.methods.reject = async function (reviewerId, reason) {
  this.status = 'rejected';
  this.rejectedAt = new Date();
  this.rejectionReason = reason;
  this.reviewedBy = reviewerId;
  this.approvedAt = null;
  return this.save();
};

/**
 * Shortlist submission
 */
submissionSchema.methods.shortlist = async function (reviewerId) {
  this.status = 'shortlisted';
  this.reviewedBy = reviewerId;
  return this.save();
};

/**
 * Mark as winner
 */
submissionSchema.methods.markAsWinner = async function (position, prizeAmount, reviewerId) {
  this.status = 'winner';
  this.prizePosition = position;
  this.prizeAmount = prizeAmount;
  this.reviewedBy = reviewerId;
  return this.save();
};

/**
 * Increment vote count
 */
submissionSchema.methods.incrementVotes = async function () {
  this.votes += 1;
  return this.save();
};

/**
 * Increment view count
 */
submissionSchema.methods.incrementViews = async function () {
  this.views += 1;
  return this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get submissions by contest with pagination
 */
submissionSchema.statics.getByContest = async function (contestId, options = {}) {
  const {
    status = null,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = -1
  } = options;

  const query = { contestId };
  if (status) query.status = status;

  const skip = (page - 1) * limit;

  return this.find(query)
    .populate('userId', 'username email avatar')
    .populate('fileId')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit);
};

/**
 * Get leaderboard for contest
 */
submissionSchema.statics.getLeaderboard = async function (contestId, limit = 10) {
  return this.find({
    contestId,
    status: { $in: ['approved', 'shortlisted', 'winner'] }
  })
    .populate('userId', 'username email avatar')
    .populate('fileId')
    .sort({ votes: -1, createdAt: 1 })
    .limit(limit);
};

/**
 * Get pending review submissions
 */
submissionSchema.statics.getPendingReview = async function (contestId = null) {
  const query = { status: 'pending' };
  if (contestId) query.contestId = contestId;

  return this.find(query)
    .populate('userId', 'username email')
    .populate('contestId', 'title')
    .populate('fileId')
    .sort({ createdAt: 1 }); // FIFO review
};

/**
 * Get user's submission for contest
 */
submissionSchema.statics.getUserSubmission = async function (userId, contestId) {
  return this.findOne({ userId, contestId })
    .populate('fileId')
    .populate('contestId', 'title description entryFee');
};

/**
 * Get statistics for a contest
 */
submissionSchema.statics.getContestStats = async function (contestId) {
  const stats = await this.aggregate([
    { $match: { contestId: mongoose.Types.ObjectId(contestId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const totalVotes = await this.aggregate([
    { $match: { contestId: mongoose.Types.ObjectId(contestId) } },
    { $group: { _id: null, total: { $sum: '$votes' } } }
  ]);

  return {
    byStatus: stats.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    totalVotes: totalVotes[0]?.total || 0
  };
};

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Pre-save validation
 */
submissionSchema.pre('save', function (next) {
  // Auto-set approval/rejection dates
  if (this.isModified('status')) {
    if (this.status === 'approved' && !this.approvedAt) {
      this.approvedAt = new Date();
    }
    if (this.status === 'rejected' && !this.rejectedAt) {
      this.rejectedAt = new Date();
    }
  }

  next();
});

/**
 * Pre-delete cleanup
 */
submissionSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  try {
    // Delete associated file
    const FileMeta = mongoose.model('FileMeta');
    await FileMeta.findByIdAndDelete(this.fileId);

    next();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('Submission', submissionSchema);