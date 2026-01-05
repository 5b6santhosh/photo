const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const Favorite = require('../models/Favorite');

const router = express.Router();

/**
 * GET /api/profile/me
 * Logged-in user's profile
 */
router.get('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const totalPhotos = await FileMeta.countDocuments({
            createdBy: userId,
            archived: false,
        });
        const name = user.name || user.firstName || 'Curator';

        res.json({
            id: user._id,
            login: user.login,
            name: name,
            firstName: user.firstName,
            email: user.email,
            avatarUrl: user.avatarUrl || '',
            totalPhotos,
            wins: user.wins || 0,
            streakDays: user.streakDays || 0,
        });
    } catch (e) {
        console.error('PROFILE_ME_ERROR', e);
        res.status(500).json({ message: 'Failed to load profile' });
    }
});

/**
 * GET /api/profile/:userId
 * Public profile view
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

        const user = await User.findById(userId).lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const totalPhotos = await FileMeta.countDocuments({
            createdBy: userId,
            archived: false,
            visibility: 'public',
        });
        const name = user.name || user.firstName || 'Curator';


        res.json({
            id: user._id,
            login: user.login,
            name: name,
            firstName: user.firstName,
            avatarUrl: user.avatarUrl || '',
            totalPhotos,
            wins: user.wins || 0,
            streakDays: user.streakDays || 0,
        });
    } catch (e) {
        console.error('PROFILE_PUBLIC_ERROR', e);
        res.status(500).json({ message: 'Failed to load profile' });
    }
});

/**
 * GET /api/profile/:userId/gallery
 * Returns full Reel objects (same as /feed/infinite) for user's public content
 */
router.get('/:userId/gallery',
    async (req, res) => {
        try {
            const viewerId = req.user?.id;
            const { userId } = req.params;

            // Validate userId
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(400).json({ message: 'Invalid userId' });
            }

            // Fetch user-owned, public, non-archived files
            const files = await FileMeta.find({
                createdBy: userId,
                archived: false,
                visibility: 'public',
            })
                .sort({ uploadedAt: -1 })
                .populate('createdBy', 'name avatarUrl wins')
                .populate('event', 'title')
                .lean();

            // Build liked/bookmarked sets
            let likedSet = new Set();
            let bookmarkedSet = new Set();
            if (viewerId) {
                const likes = await Like.find({
                    userId: viewerId,
                    fileId: { $in: files.map(f => f._id) },
                }).distinct('fileId');
                likedSet = new Set(likes.map(id => id.toString()));

                const favs = await Favorite.find({
                    userId: viewerId,
                    fileId: { $in: files.map(f => f._id) },
                }).distinct('fileId');
                bookmarkedSet = new Set(favs.map(id => id.toString()));
            }

            // Build full Reel objects (MUST match /feed/infinite structure)
            const gallery = files.map(f => {
                const isVideo = f.mimeType?.startsWith('video/');
                const category = f.category || 'other';

                //  Null-safe user data
                const user = f.createdBy || {};
                const userName = user.name || user.firstName || 'Curator';

                return {
                    id: f._id.toString(),
                    mediaType: isVideo ? 'reel' : 'image',
                    photo: {
                        id: f._id.toString(),
                        title: f.title || 'Untitled',
                        location: f.location || '',
                        date: f.uploadedAt,
                        category: category,
                        imageUrl: isVideo
                            ? (f.thumbnailUrl || f.path)
                            : f.path,
                    },
                    videoUrl: isVideo ? f.path : null,
                    user: {
                        id: user._id?.toString() || '',
                        name: userName,
                        avatarUrl: user.avatarUrl || '',
                        wins: user.wins || 0,
                    },
                    eventTitle: f.event?.title || 'General',
                    likes: f.likesCount || 0,
                    comments: f.commentsCount || 0,
                    isLiked: likedSet.has(f._id.toString()),
                    isBookmarked: bookmarkedSet.has(f._id.toString()),
                };
            });

            res.json({ gallery });

        } catch (e) {
            console.error('PROFILE_GALLERY_ERROR', e);
            res.status(500).json({ message: 'Failed to load gallery' });
        }
    });

/**
 * PUT /api/profile/me
 */
router.put('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstName, avatarUrl } = req.body;
        const updateFields = { firstName, avatarUrl };


        const updated = await User.findByIdAndUpdate(
            userId,
            updateFields,
            { new: true }
        ).lean();

        res.json({
            success: true,
            user: {
                id: updated._id,
                name: updated.name || updated.firstName,
                firstName: updated.firstName,
                avatarUrl: updated.avatarUrl,
            },
        });
    } catch (e) {
        console.error('PROFILE_UPDATE_ERROR', e);
        res.status(500).json({ message: 'Failed to update profile' });
    }
});
module.exports = router;
