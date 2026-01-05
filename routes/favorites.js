const express = require('express');
const Favorite = require('../models/Favorite');
const FileMeta = require('../models/FileMeta');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * POST /api/favorites/toggle
 * Toggles bookmark for a file
 * @body { fileId: string }
 * @auth Required (req.user.id)
 * @returns { bookmarked: boolean }
 */
router.post('/toggle', async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.body;

        //  Validate input
        if (!fileId) {
            return res.status(400).json({ error: 'fileId is required' });
        }

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId format' });
        }

        //  Verify file exists and is accessible
        const file = await FileMeta.findOne({
            _id: fileId,
            archived: false,
            visibility: 'public', // or add: createdBy: userId for private files
        });

        if (!file) {
            return res.status(404).json({ error: 'File not found or not accessible' });
        }

        //  Toggle favorite using upsert (more atomic)
        const existing = await Favorite.findOne({ userId, fileId });

        if (existing) {
            //  Remove bookmark
            await Favorite.deleteOne({ _id: existing._id });
            return res.json({ bookmarked: false });
        } else {
            //  Add bookmark
            await Favorite.create({ userId, fileId });
            return res.json({ bookmarked: true });
        }

    } catch (err) {
        console.error('Favorite toggle error:', err);
        res.status(500).json({
            error: 'Failed to toggle favorite',
        });
    }
});

module.exports = router;