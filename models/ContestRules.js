const mongoose = require('mongoose');

const ContestRulesSchema = new mongoose.Schema({
    contestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contest',
        required: true,
        unique: true,
        index: true
    },

    // ======================
    // THEME & SEMANTICS
    // ======================
    theme: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true
    },

    keywords: {
        type: [String],
        default: [],
        lowercase: true
    },

    // ======================
    // VISUAL STYLE RULES
    // ======================
    minEntropy: {
        type: Number,
        default: 4.5,
        min: 0,
        max: 10
    },
    maxEntropy: {
        type: Number,
        default: 7.5,
        min: 0,
        max: 10
    },

    preferredColor: {
        type: String,
        enum: ['green', 'blue', 'red', 'warm', 'cool', 'any'],
        default: 'any'
    },

    // ======================
    // PEOPLE / SKIN RULES
    // ======================
    skinRange: {
        type: [Number], // [min %, max %]
        default: [0, 40],
        validate: {
            validator: v => v.length === 2 && v[0] >= 0 && v[1] <= 100,
            message: 'skinRange must be [min, max] percentage'
        }
    },

    allowPeople: {
        type: Boolean,
        default: true
    },

    // ======================
    // MEDIA FORMAT RULES
    // ======================
    allowImage: {
        type: Boolean,
        default: true
    },
    allowVideo: {
        type: Boolean,
        default: true
    },

    requireVertical: {
        type: Boolean,
        default: false
    },

    maxDurationSeconds: {
        type: Number,
        default: 60,
        min: 1,
        max: 300
    },

    // ======================
    // AI & MODERATION
    // ======================
    strictThemeMatch: {
        type: Boolean,
        default: false
    },

    autoRejectNSFW: {
        type: Boolean,
        default: true
    },

    autoApproveScore: {
        type: Number,
        default: 75,
        min: 0,
        max: 100
    },

    autoReviewScore: {
        type: Number,
        default: 50,
        min: 0,
        max: 100
    }

}, {
    timestamps: true
});

module.exports = mongoose.model('ContestRules', ContestRulesSchema);
