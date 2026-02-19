const mongoose = require('mongoose');

const MLFeatureLogSchema = new mongoose.Schema({

    // 🔗 References
    contestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contest',
        index: true
    },

    entryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContestEntry',
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },

    mediaType: {
        type: String,
        enum: ['image', 'video'],
        required: true
    },

    // ======================
    // 📷 RAW FEATURES (PHASE-1)
    // ======================
    features: {

        // Resolution & structure
        width: Number,
        height: Number,
        aspectRatio: Number,
        megapixels: Number,

        // Image quality
        sharpness: Number,       
        brightness: Number,
        contrast: Number,
        entropy: Number,

        // Safety
        skinExposureRatio: Number,
        hasAudio: Boolean,

        // Video-only
        duration: Number,
        fps: Number,
        bitrate: Number,

        perceptualHash: {
            type: String,
            index: true
        },

        colorDominance: {
            red: { type: Number, default: 0 },      // 0-1 percentage
            green: { type: Number, default: 0 },    // 0-1 percentage  
            blue: { type: Number, default: 0 }     // 0-1 percentage
        }

    },

    // ======================
    // 🧠 AI FEATURES (PHASE-2)
    // ======================
    aiSignals: {
        nsfwScore: Number,
        themeSimilarity: Number,
        perceptualQuality: Number
    },

    // ======================
    // 🏁 FINAL OUTPUT
    // ======================
    scores: {
        quality: Number,
        safety: Number,
        theme: Number,
        finalScore: Number
    },

    verdict: {
        type: String,
        enum: ['approved', 'review', 'rejected'],
        index: true
    },

    duplicateOf: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MLFeatureLog',
        default: null,
        index: true
    },

    // ======================
    // 👨‍⚖️ HUMAN FEEDBACK (LATER)
    // ======================
    humanReview: {
        reviewed: { type: Boolean, default: false },
        finalVerdict: String,
        rating: Number,          // Judge score (0-100)
        notes: String
    },

    // ======================
    // 🧪 ML CONTROL
    // ======================
    modelVersion: {
        type: String,
        default: 'phase1+phase2'
    }

}, { timestamps: true });

module.exports = mongoose.model('MLFeatureLog', MLFeatureLogSchema);