const express = require('express');
const mongoose = require('mongoose');
const Like = require('../models/Like');
const FileMeta = require('../models/FileMeta');
// FIX: Import authMiddleware (not protect)
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/likes/toggle
 * Toggles like status for a file by a user
 */
// FIX: Use authMiddleware instead of protect
router.post('/toggle', authMiddleware, async (req, res) => {
    try {
        // Defensive check (optional since authMiddleware guarantees req.user)
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = req.user.id;
        const { fileId } = req.body;

        if (!fileId) {
            return res.status(400).json({ error: 'fileId is required' });
        }

        // Validate and convert to ObjectId
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId format' });
        }
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid userId format' });
        }

        const fileObjectId = new mongoose.Types.ObjectId(fileId);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // 1. Attempt to remove the like first (Unlike)
        const removed = await Like.findOneAndDelete({
            fileId: fileObjectId,
            userId: userObjectId
        });

        let liked;
        let updatedMeta;

        if (removed) {
            liked = false;
            updatedMeta = await FileMeta.findByIdAndUpdate(
                fileObjectId,
                { $inc: { likesCount: -1 } },
                { new: true }
            );
            // Ensure likesCount doesn't go below 0
            if (updatedMeta && updatedMeta.likesCount < 0) {
                updatedMeta.likesCount = 0;
                await updatedMeta.save();
            }
        } else {
            // 2. Attempt to create the like (Like)
            try {
                await Like.create({
                    fileId: fileObjectId,
                    userId: userObjectId
                });
                liked = true;
                updatedMeta = await FileMeta.findByIdAndUpdate(
                    fileObjectId,
                    { $inc: { likesCount: 1 } },
                    { new: true }
                );
            } catch (err) {
                // Handle duplicate key error (rapid double-click)
                if (err.code === 11000) {
                    liked = true;
                    updatedMeta = await FileMeta.findById(fileObjectId);
                } else {
                    throw err;
                }
            }
        }

        res.json({
            liked,
            likesCount: updatedMeta?.likesCount ?? 0,
        });
    } catch (err) {
        console.error('Like toggle error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;