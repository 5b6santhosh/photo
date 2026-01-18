const mongoose = require('mongoose');

const ContestAppealSchema = new mongoose.Schema({
    contestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contest',
        required: true,
        index: true
    },

    entryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContestEntry',
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    originalVerdict: {
        type: String,
        enum: ['approved', 'review', 'rejected'],
        required: true
    },

    appealReason: {
        type: String,
        required: true,
        maxlength: 1000
    },

    aiExplanationSnapshot: {
        type: Object, // store explanation at appeal time
        required: true
    },

    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending',
        index: true
    },

    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
    },

    reviewerNotes: {
        type: String,
        default: ''
    }

}, { timestamps: true });

ContestAppealSchema.index({ entryId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ContestAppeal', ContestAppealSchema);
