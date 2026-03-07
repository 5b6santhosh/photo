const express = require('express');
const Share = require('../models/Share');
const FileMeta = require('../models/FileMeta');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/shares/track
 * Tracks unique shares per authenticated user
 * @body { fileId: string }
 * @auth Required (req.user.id)
 * @returns { success: boolean, sharesCount: number, alreadyShared: boolean }
 */
router.post('/track', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.body;

        // Validate inputs
        if (!fileId) {
            return res.status(400).json({
                success: false,
                error: 'fileId required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid fileId'
            });
        }

        // Verify file exists and is accessible
        const file = await FileMeta.findOne({
            _id: fileId,
            archived: false,
            $or: [
                { visibility: 'public' },
                { createdBy: userId }
            ]
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        // Try to create share record
        let isNewShare = false;

        try {
            await Share.create({ userId, fileId });
            isNewShare = true;
        } catch (err) {
            if (err.code === 11000) {
                // Duplicate key - already shared
                isNewShare = false;
            } else {
                throw err;
            }
        }

        // Only increment sharesCount if this is a NEW share
        let finalSharesCount = file.sharesCount || 0;

        if (isNewShare) {
            const updatedFile = await FileMeta.findByIdAndUpdate(
                fileId,
                { $inc: { sharesCount: 1 } },
                { new: true }
            );
            finalSharesCount = updatedFile.sharesCount;
        }

        res.json({
            success: true,
            sharesCount: finalSharesCount,
            alreadyShared: !isNewShare
        });

    } catch (err) {
        console.error('Share track error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to track share',
            message: err.message
        });
    }
});

/**
 * GET /api/shares/count/:fileId
 * Get share count for a file (public)
 */
router.get('/count/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid fileId'
            });
        }

        const file = await FileMeta.findById(fileId).select('sharesCount');

        res.json({
            success: true,
            sharesCount: file?.sharesCount || 0
        });

    } catch (err) {
        console.error('Get share count error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get share count'
        });
    }
});

module.exports = router;