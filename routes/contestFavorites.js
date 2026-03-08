const express = require('express');
const ContestFavorite = require('../models/ContestFavorite');
const Contest = require('../models/Contest');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/contest-favorites/toggle
 * Save or unsave a contest
 */
router.post('/toggle', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { contestId } = req.body;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ success: false, error: 'Valid contestId is required' });
        }

        const contest = await Contest.findOne({ _id: contestId, isPublic: true });
        if (!contest) {
            return res.status(404).json({ success: false, error: 'Contest not found' });
        }

        const existing = await ContestFavorite.findOne({ userId, contestId });
        let isSaved;

        if (existing) {
            await ContestFavorite.deleteOne({ _id: existing._id });
            isSaved = false;
        } else {
            await ContestFavorite.create({ userId, contestId });
            isSaved = true;
        }

        res.json({ success: true, data: { isSaved, contestId } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/contest-favorites/my
 * Get all saved contests for the current user
 * → feeds the Flutter Contests tab (savedEvents list)
 */
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const saved = await ContestFavorite.find({ userId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate({
                path: 'contestId',
                select: 'title subtitle description prizeText startDate endDate contestStatus entryFee highlightPhotos bannerImage',
            });

        const formatted = saved
            .filter(f => f.contestId)
            .map(f => {
                const c = f.contestId;
                return {
                    id: c._id.toString(),
                    title: c.title,
                    subtitle: c.subtitle || c.description || '',
                    prizeText: c.prizeText,
                    startDate: c.startDate,
                    endDate: c.endDate,
                    status: c.contestStatus,
                    entryFee: c.entryFee,
                    bannerImage: c.bannerImage || '',
                    isSaved: true,
                };
            });

        res.json({
            success: true,
            data: formatted,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: await ContestFavorite.countDocuments({ userId }),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/contest-favorites/status
 * Check save status for multiple contests at once
 */
router.post('/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { contestIds } = req.body;

        if (!Array.isArray(contestIds)) {
            return res.status(400).json({ success: false, error: 'contestIds must be an array' });
        }

        const saved = await ContestFavorite.find({
            userId,
            contestId: { $in: contestIds },
        }).select('contestId');

        const savedIds = saved.map(f => f.contestId.toString());
        const statusMap = {};
        contestIds.forEach(id => { statusMap[id] = savedIds.includes(id); });

        res.json({ success: true, data: statusMap });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;