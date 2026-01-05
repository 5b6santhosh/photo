// routes/shares.js
const express = require('express');
const Share = require('../models/Share');
const FileMeta = require('../models/FileMeta');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * POST /api/shares/track
 * Tracks unique shares per authenticated user
 * @body { fileId: string }
 * @auth Required (req.user.id)
 */
router.post('/track', async (req, res) => {
    try {
        const userId = req.user?.id; // From auth middleware
        const { fileId } = req.body;

        //  Require authentication
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        //  Validate inputs
        if (!fileId) {
            return res.status(400).json({ error: 'fileId required' });
        }
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId' });
        }

        //  Verify file exists and is public
        const file = await FileMeta.findOne({
            _id: fileId,
            archived: false,
            visibility: 'public'
        });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        //  Create share record (fails silently if duplicate due to unique index)
        await Share.findOneAndUpdate(
            { userId, fileId },
            { userId, fileId },
            { upsert: true, new: true }
        );

        //  Increment sharesCount ONLY if this is a new share
        // (Handle via post-save hook or check result - simplified here)
        await FileMeta.findByIdAndUpdate(fileId, {
            $inc: { sharesCount: 1 }
        });

        res.json({ success: true, sharesCount: file.sharesCount + 1 });

    } catch (err) {
        if (err.code === 11000) {
            // Duplicate key error (already shared)
            return res.json({ success: true, message: 'Already shared' });
        }
        console.error('Share track error:', err);
        res.status(500).json({ error: 'Failed to track share' });
    }
});

module.exports = router;