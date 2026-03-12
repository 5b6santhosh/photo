const express = require('express');
const router = express.Router();
const Ad = require('../models/Ad');

// ── GET /ads/feed ─────────────────────────────────────────────────────────────
// Returns a pool of active ads to be injected client-side every 5 items.
router.get('/feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 20);
        const now = new Date();

        const ads = await Ad.aggregate([
            {
                $match: {
                    isActive: true,
                    $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }],
                },
            },
            { $sample: { size: limit } }, // randomise each session
        ]);

        const formatted = ads.map((ad) => ({
            id: ad._id.toString(),
            type: 'ad', // Flutter uses this to distinguish ads from reels
            title: ad.title,
            description: ad.description || '',
            imageUrl: ad.imageUrl,
            videoUrl: ad.videoUrl || null,
            isVideo: ad.isVideo || false,
            ctaText: ad.ctaText,
            ctaUrl: ad.ctaUrl,
            advertiserName: ad.advertiserName,
            advertiserLogoUrl: ad.advertiserLogoUrl || '',
        }));

        res.json({ status: 'success', ads: formatted });
    } catch (err) {
        console.error('ADS_FEED_ERROR:', err);
        res.status(500).json({ status: 'error', message: 'Failed to load ads' });
    }
});

// ── POST /ads/:id/impression ──────────────────────────────────────────────────
router.post('/:id/impression', async (req, res) => {
    try {
        await Ad.findByIdAndUpdate(req.params.id, { $inc: { impressions: 1 } });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// ── POST /ads/:id/click ───────────────────────────────────────────────────────
router.post('/:id/click', async (req, res) => {
    try {
        await Ad.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

module.exports = router;