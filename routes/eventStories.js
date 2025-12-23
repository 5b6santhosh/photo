const express = require('express');
const router = express.Router();

const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');

/**
 * GET /api/events/:eventId/highlights
 * Curated Story Viewer API (Reels style)
 */
router.get('/:eventId/highlights', async (req, res) => {
    try {
        const { eventId } = req.params;
        const userId = req.user?.id || null;

        // 1️⃣ Fetch contest
        const contest = await Contest.findById(eventId).lean();
        if (!contest) {
            return res.status(404).json({ message: 'Event not found' });
        }

        if (!contest.highlightPhotos || contest.highlightPhotos.length === 0) {
            return res.json({
                title: contest.title,
                photos: [],
            });
        }

        // 2️⃣ Fetch all highlight photos
        const photos = await FileMeta.find({
            _id: { $in: contest.highlightPhotos },
            visibility: 'public',
        })
            .sort({ uploadedAt: 1 }) // story order
            .lean();

        // 3️⃣ Map for Flutter CuratedStoryViewerScreen
        const curatedPhotos = await Promise.all(
            photos.map(async (p) => {
                const likes = await Like.countDocuments({ fileId: p._id });
                const isLiked = userId
                    ? await Like.exists({ fileId: p._id, userId })
                    : false;

                return {
                    id: p._id.toString(),
                    title: p.title || '',
                    imageUrl: `${process.env.BASE_URL}/uploads/${p.fileName}`,
                    category: p.category || 'other',
                    location: p.location || '',
                    date: p.uploadedAt,
                    peopleCount: p.peopleCount || 0,
                    likes,
                    isLiked: !!isLiked,
                    isFavorite: false, // later from bookmarks
                };
            })
        );

        res.json({
            eventId: contest._id,
            title: contest.title,
            photos: curatedPhotos,
        });
    } catch (err) {
        console.error('CURATED STORY ERROR:', err);
        res.status(500).json({ message: 'Failed to load curated story' });
    }
});

module.exports = router;
