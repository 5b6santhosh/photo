const express = require('express');
const router = express.Router();
const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');

/**
 * GET /api/contests/:id/stories
 */
router.get('/:id/stories', async (req, res) => {
    try {
        const contest = await Contest.findById(req.params.id).lean();
        if (!contest) return res.status(404).json({ message: 'Event not found' });

        const photos = await FileMeta.find({
            _id: { $in: contest.highlightPhotos }
        }).lean();

        const stories = photos.map(p => ({
            id: p._id,
            imageUrl: `${process.env.BASE_URL}/uploads/${p.fileName}`,
            title: p.title || 'Curated shot',
            createdBy: p.createdByName
        }));

        res.json({
            eventId: contest._id,
            title: contest.title,
            stories
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load stories' });
    }
});

module.exports = router;
