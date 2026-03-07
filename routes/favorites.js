const express = require('express');
const Favorite = require('../models/Favorite');
const FileMeta = require('../models/FileMeta');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/favorites/toggle
 * Toggles bookmark for a file (personal save, does NOT affect likesCount)
 * @body { fileId: string }
 * @auth Required
 * @returns { bookmarked: boolean, isBookmarked: boolean }
 */
router.post('/toggle', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.body;

        // Validate input
        if (!fileId) {
            return res.status(400).json({
                success: false,
                error: 'fileId is required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid fileId format'
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
                error: 'File not found or not accessible'
            });
        }

        // Toggle favorite (NO likesCount changes - that's separate!)
        const existing = await Favorite.findOne({ userId, fileId });

        let isBookmarked;

        if (existing) {
            // Remove bookmark
            await Favorite.deleteOne({ _id: existing._id });
            isBookmarked = false;
        } else {
            // Add bookmark
            await Favorite.create({ userId, fileId });
            isBookmarked = true;
        }

        res.json({
            success: true,
            data: {
                bookmarked: isBookmarked,
                isBookmarked: isBookmarked,
                fileId: fileId
            }
        });

    } catch (err) {
        console.error('Favorite toggle error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle favorite',
            message: err.message
        });
    }
});

/**
 * POST /api/favorites/status
 * Get favorite status for multiple files
 */
router.post('/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileIds } = req.body;

        if (!Array.isArray(fileIds)) {
            return res.status(400).json({
                success: false,
                error: 'fileIds must be an array'
            });
        }

        const favorites = await Favorite.find({
            userId,
            fileId: { $in: fileIds }
        }).select('fileId');

        const favoritedIds = favorites.map(f => f.fileId.toString());

        const statusMap = {};
        fileIds.forEach(id => {
            statusMap[id] = {
                bookmarked: favoritedIds.includes(id),
                isBookmarked: favoritedIds.includes(id)
            };
        });

        res.json({
            success: true,
            data: statusMap
        });

    } catch (err) {
        console.error('Get favorites status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get favorite status'
        });
    }
});

/**
 * GET /api/favorites/my
 * Get all favorites for current user
 */
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const favorites = await Favorite.find({ userId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate({
                path: 'fileId',
                select: '_id path thumbnailPath title subtitle description location uploadedAt peopleCount category likesCount aspectRatio blurHash createdBy',
                populate: {
                    path: 'createdBy',
                    select: 'name username'
                }
            });

        const formattedPhotos = favorites
            .filter(f => f.fileId)
            .map(f => ({
                id: f.fileId._id.toString(),
                url: f.fileId.path,
                thumbnailUrl: f.fileId.thumbnailPath || f.fileId.path,
                title: f.fileId.title || 'Untitled',
                subtitle: f.fileId.subtitle || f.fileId.description || '',
                location: f.fileId.location || '',
                date: f.fileId.uploadedAt?.toISOString(),
                peopleCount: f.fileId.peopleCount || 0,
                category: f.fileId.category || 'other',
                likesCount: f.fileId.likesCount || 0,  // This is the PUBLIC like count
                isFavorite: true,                      // User has bookmarked this
                isBookmarked: true,
                aspectRatio: f.fileId.aspectRatio || 9 / 16,
                blurHash: f.fileId.blurHash,
                userName: f.fileId.createdBy?.name || f.fileId.createdBy?.username || 'Unknown',
                isCurated: false
            }));

        res.json({
            success: true,
            data: formattedPhotos,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: await Favorite.countDocuments({ userId })
            }
        });

    } catch (err) {
        console.error('Get my favorites error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get favorites'
        });
    }
});

module.exports = router;