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

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    position: {
        type: Number,
        default: null
    },
    aiScore: {
        type: Number,
        default: null
    },
    aiRank: {
        type: Number,
        default: null
    },

    finalDecision: {
        type: String,
        enum: ['approved', 'rejected', 'winner', 'disqualified'],
        required: true
    },

    overrideReason: {
        type: String,
        default: null
    },
    selectedAt: {
        type: Date,
        default: Date.now
    },
    overridesAI: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });


JudgeDecisionSchema.index({ contestId: 1, finalDecision: 1 });
JudgeDecisionSchema.index({ contestId: 1, entryId: 1 }, { unique: true });

module.exports = mongoose.model('JudgeDecision', JudgeDecisionSchema);
