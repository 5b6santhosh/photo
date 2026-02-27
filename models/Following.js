const mongoose = require('mongoose');

const FollowingSchema = new mongoose.Schema({
    follower: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    following: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
},
    { timestamps: true }
);

// Prevent duplicate follows
FollowingSchema.index({ follower: 1, following: 1 }, { unique: true });

module.exports = mongoose.model('Following', FollowingSchema);