// routes/eventStories.js
const express = require('express');
const router = express.Router();
const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');

router.get('/:eventId/highlights', async (req, res) => {
    try {
        const { eventId } = req.params;
        const userId = req.user?.id || null;

        const contest = await Contest.findById(eventId).lean();
        if (!contest) {
            return res.status(404).json({ message: 'Event not found' });
        }

        if (!contest.highlightPhotos?.length) {
            return res.json({ title: contest.title, photos: [] });
        }

        const photos = await FileMeta.find({
            _id: { $in: contest.highlightPhotos },
            visibility: 'public'
        }).sort({ uploadedAt: 1 }).lean();

        // Fetch all liked file IDs in one query (efficient)
        let likedFileIds = [];
        if (userId) {
            likedFileIds = await Like.find({ userId })
                .distinct('fileId')
                .then(ids => ids.map(id => id.toString()));
        }

        const curatedPhotos = photos.map(p => ({
            id: p._id.toString(),
            title: p.title || '',
            imageUrl: p.path, //  Cloudinary URL
            category: p.category || 'other',
            location: p.location || '',
            date: p.uploadedAt,
            peopleCount: p.peopleCount || 0,
            likes: p.likesCount || 0, //  Use precomputed count
            isLiked: likedFileIds.includes(p._id.toString()),
            isFavorite: false
        }));

        res.json({
            eventId: contest._id,
            title: contest.title,
            photos: curatedPhotos
        });
    } catch (err) {
        console.error('CURATED STORY ERROR:', err);
        res.status(500).json({ message: 'Failed to load curated story' });
    }
});

module.exports = router;