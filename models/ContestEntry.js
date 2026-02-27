const mongoose = require('mongoose');

const ContestEntrySchema = new mongoose.Schema({
    contestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contest',
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    paymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        required: false,
        default: null
    },

    status: {
        type: String,
        enum: ['paid', 'submitted', 'disqualified', 'refunded', 'pending', 'rejected'],
        default: 'paid',
        index: true
    },

    submittedAt: {
        type: Date,
        default: null
    },
    breakdown: {
        quality: Number,
        safety: Number,
        theme: Number
    },
    verdict: String,


}, { timestamps: true });

/**
 *  HARD GUARANTEE
 * One paid entry per user per contest
 */
ContestEntrySchema.index(
    { contestId: 1, userId: 1 },
    { unique: true }
);

module.exports = mongoose.model('ContestEntry', ContestEntrySchema);
