const mongoose = require('mongoose');

const JudgeDecisionSchema = new mongoose.Schema({
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

    judgeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    aiScore: Number,
    aiRank: Number,

    finalDecision: {
        type: String,
        enum: ['approved', 'rejected', 'winner', 'disqualified'],
        required: true
    },

    overrideReason: {
        type: String,
        maxlength: 1000
    },

    overridesAI: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

JudgeDecisionSchema.index(
    { contestId: 1, entryId: 1 },
    { unique: true }
);

module.exports = mongoose.model('JudgeDecision', JudgeDecisionSchema);
