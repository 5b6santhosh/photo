const express = require('express');
const Like = require('../models/Like');
const FileMeta = require('../models/FileMeta'); //  IMPORT FileMeta

const router = express.Router();

/**
 * POST /api/likes/toggle
 * Toggles like status for a file by a user
 * @body { fileId: string, userId: string }
 * @returns { liked: boolean, likesCount?: number }
//  */
router.post('/toggle', async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.body;

        if (!fileId) return res.status(400).json({ error: 'fileId is required' });

        // 1. Attempt to remove the like first (Unlike)
        const removed = await Like.findOneAndDelete({ fileId, userId });

        let liked;
        let updatedMeta;

        if (removed) {
            liked = false;
            updatedMeta = await FileMeta.findByIdAndUpdate(
                fileId,
                { $inc: { likesCount: -1 }, $max: { likesCount: 0 } },
                { new: true }
            );
        } else {
            // 2. Attempt to create the like (Like)
            try {
                await Like.create({ fileId, userId });
                liked = true;
                updatedMeta = await FileMeta.findByIdAndUpdate(
                    fileId,
                    { $inc: { likesCount: 1 } },
                    { new: true }
                );
            } catch (err) {
                // Handle case where user clicked like twice rapidly (Duplicate Key Error)
                if (err.code === 11000) {
                    liked = true;
                    updatedMeta = await FileMeta.findById(fileId);
                } else { throw err; }
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