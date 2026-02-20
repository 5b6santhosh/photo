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
        required: [true, 'Theme is required'],
        trim: true,
        lowercase: true,
        index: true
    },

    keywords: {
        type: [String],
        default: [],
        set: v => v.map(k => k.toLowerCase().trim()) // Auto-normalize keywords
    },

    // ======================
    // VISUAL STYLE RULES
    // ======================
    minEntropy: {
        type: Number,
        default: 4.5,
        min: [0, 'Minimum entropy cannot be less than 0'],
        max: [10, 'Maximum entropy cannot exceed 10']
    },
    maxEntropy: {
        type: Number,
        default: 7.5,
        min: [0, 'Minimum entropy cannot be less than 0'],
        max: [10, 'Maximum entropy cannot exceed 10'],
        validate: {
            validator: function (v) {
                return v >= this.minEntropy;
            },
            message: 'maxEntropy must be greater than or equal to minEntropy'
        }
    },

    preferredColor: {
        type: String,
        enum: {
            values: ['green', 'blue', 'red', 'warm', 'cool', 'any', 'monochrome', 'vibrant'],
            message: 'Preferred color {VALUE} is not supported'
        },
        default: 'any'
    },

    // ======================
    // PEOPLE / SKIN RULES
    // ======================
    skinRange: {
        type: [Number], // [min %, max %]
        default: [0, 40],
        validate: {
            validator: function (v) {
                return Array.isArray(v) &&
                    v.length === 2 &&
                    v[0] >= 0 &&
                    v[1] <= 100 &&
                    v[0] <= v[1];
            },
            message: 'skinRange must be [min, max] where 0 <= min <= max <= 100'
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
        min: [1, 'Duration must be at least 1 second'],
        max: [300, 'Duration cannot exceed 300 seconds (5 minutes)']
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
        min: [0, 'Score cannot be less than 0'],
        max: [100, 'Score cannot exceed 100'],
        validate: {
            validator: function (v) {
                return v >= this.autoReviewScore;
            },
            message: 'autoApproveScore must be greater than or equal to autoReviewScore'
        }
    },

    autoReviewScore: {
        type: Number,
        default: 50,
        min: [0, 'Score cannot be less than 0'],
        max: [100, 'Score cannot exceed 100']
    },

    // ======================
    // NEW: ADDITIONAL SAFETY
    // ======================
    minResolution: {
        type: String,
        enum: ['any', '720p', '1080p', '2k', '4k'],
        default: 'any'
    },

    maxFileSizeMB: {
        type: Number,
        default: 50,
        min: 1,
        max: 500
    }

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual to check if rules are valid for the contest type
ContestRulesSchema.virtual('isValidConfig').get(function () {
    return this.theme && this.theme.length > 0;
});

// Pre-save middleware to ensure consistency
ContestRulesSchema.pre('save', function (next) {
    // Ensure keywords are unique and sorted
    if (this.keywords && this.keywords.length > 0) {
        this.keywords = [...new Set(this.keywords)].sort();
    }

    // Ensure skinRange is sorted
    if (this.skinRange && this.skinRange.length === 2) {
        this.skinRange = [Math.min(...this.skinRange), Math.max(...this.skinRange)];
    }

    next();
});

module.exports = mongoose.model('ContestRules', ContestRulesSchema);