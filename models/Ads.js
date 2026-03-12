const mongoose = require('mongoose');

const adSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        description: { type: String, default: '' },
        imageUrl: { type: String, required: true },
        videoUrl: { type: String, default: null },
        isVideo: { type: Boolean, default: false },
        ctaText: { type: String, default: 'Learn More' },
        ctaUrl: { type: String, required: true },
        advertiserName: { type: String, required: true },
        advertiserLogoUrl: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
        impressions: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
        expiresAt: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Ad', adSchema);