const express = require('express');
const mongoose = require('mongoose');
const { authMiddleware: auth, optionalAuth } = require('../middleware/auth');
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

        const user = await User.findById(userId)
            // .select('-password -resetPasswordToken -resetPasswordExpire -__v')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        //  Count all photos (including private ones for own profile)
        const totalPhotos = await FileMeta.countDocuments({
            createdBy: userId,
            archived: false,
        });

        const name = user.name || user.firstName || 'Curator';

        res.json({
            success: true,
            user: {
                id: user._id,
                login: user.username,
                name: name,
                firstName: user.firstName,
                email: user.email,
                bio: user.bio || '',
                avatarUrl: user.avatarUrl || '',
                totalPhotos,
                wins: user.wins || 0,
                streakDays: user.streakDays || 0,
            }
        });
    } catch (e) {
        console.error('PROFILE_ME_ERROR', e);
        res.status(500).json({
            success: false,
            message: 'Failed to load profile'
        });
    }
});

/**
 * GET /api/profile/:userId
 * Public profile view
 *  FIXED: Now supports optional authentication
 */
router.get('/:userId', optionalAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const viewerId = req.user?.id;

        //  Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid userId'
            });
        }

        const user = await User.findById(userId)
            .select('name firstName username avatarUrl bio wins streakDays')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        //  If viewing own profile, show all photos; otherwise show only public
        const photoQuery = {
            createdBy: userId,
            archived: false,
        };

        // Only filter by visibility if not viewing own profile
        if (!viewerId || viewerId !== userId) {
            photoQuery.visibility = 'public';
        }

        const totalPhotos = await FileMeta.countDocuments(photoQuery);
        const name = user.name || user.firstName || 'Curator';

        res.json({
            success: true,
            user: {
                id: user._id,
                login: user.username,
                name: name,
                firstName: user.firstName,
                bio: user.bio || '',
                avatarUrl: user.avatarUrl || '',
                totalPhotos,
                wins: user.wins || 0,
                streakDays: user.streakDays || 0,
                isOwnProfile: viewerId === userId, //  Let frontend know if this is user's own profile
            }
        });
    } catch (e) {
        console.error('PROFILE_PUBLIC_ERROR', e);
        res.status(500).json({
            success: false,
            message: 'Failed to load profile'
        });
    }
});

/**
 * GET /api/profile/:userId/gallery
 * Returns full Reel objects (same as /feed/infinite) for user's content
 *  FIXED: Proper authentication, pagination, and error handling
 */
router.get('/:userId/gallery', optionalAuth, async (req, res) => {
    try {
        const viewerId = req.user?.id;
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query; //  Add pagination

        //  Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid userId'
            });
        }

        //  Validate pagination params
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Cap at 50
        const skip = (pageNum - 1) * limitNum;

        // 1. Fetch user data
        const targetUser = await User.findById(userId)
            .select('name firstName avatarUrl bio wins streakDays')
            .lean();

        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // 2. Build query - show all if viewing own profile, only public otherwise
        const galleryQuery = {
            createdBy: userId,
            archived: false,
        };

        if (!viewerId || viewerId !== userId) {
            galleryQuery.visibility = 'public';
        }

        //  Get total count for pagination
        const totalCount = await FileMeta.countDocuments(galleryQuery);

        // 3. Fetch files with pagination
        const files = await FileMeta.find(galleryQuery)
            .sort({ uploadedAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate('createdBy', 'name firstName avatarUrl wins')
            .populate('event', 'title')
            .lean();

        //  Handle case when no files found
        if (files.length === 0) {
            return res.json({
                success: true,
                user: {
                    id: targetUser._id,
                    name: targetUser.name || targetUser.firstName || 'Curator',
                    wins: targetUser.wins || 0,
                    avatarUrl: targetUser.avatarUrl || '',
                    bio: targetUser.bio || '',
                },
                gallery: [],
                pagination: {
                    currentPage: pageNum,
                    totalPages: 0,
                    totalItems: 0,
                    itemsPerPage: limitNum,
                    hasMore: false,
                }
            });
        }

        // 4. Build liked/bookmarked sets for the viewer
        let likedSet = new Set();
        let bookmarkedSet = new Set();

        if (viewerId) {
            const fileIds = files.map(f => f._id);
            const [likes, favs] = await Promise.all([
                Like.find({
                    userId: viewerId,
                    fileId: { $in: fileIds }
                }).distinct('fileId'),
                Favorite.find({
                    userId: viewerId,
                    fileId: { $in: fileIds }
                }).distinct('fileId')
            ]);
            likedSet = new Set(likes.map(id => id.toString()));
            bookmarkedSet = new Set(favs.map(id => id.toString()));
        }

        // 5. Build gallery items matching Flutter's Reel & PhotoModel expectations
        const gallery = files.map(f => {
            const isVideo = f.mimeType?.startsWith('video/');
            const user = f.createdBy || {};
            const displayName = user.name || user.firstName || 'Curator';

            return {
                id: f._id.toString(),
                mediaType: isVideo ? 'reel' : 'photo',
                photo: {
                    id: f._id.toString(),
                    title: f.title || 'Untitled',
                    location: f.location || '',
                    date: f.uploadedAt,
                    category: f.category || 'other',
                    imageUrl: isVideo ? (f.thumbnailUrl || f.path) : f.path,
                },
                videoUrl: isVideo ? f.path : null,
                user: {
                    id: user._id?.toString() || '',
                    name: displayName,
                    avatarUrl: user.avatarUrl || '',
                    wins: user.wins || 0,
                },
                eventTitle: f.event?.title || 'General',
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: likedSet.has(f._id.toString()),
                isBookmarked: bookmarkedSet.has(f._id.toString()),
                visibility: f.visibility || 'public', //  Include visibility
            };
        });

        //  Calculate pagination info
        const totalPages = Math.ceil(totalCount / limitNum);
        const hasMore = pageNum < totalPages;

        res.json({
            success: true,
            user: {
                id: targetUser._id,
                name: targetUser.name || targetUser.firstName || 'Curator',
                wins: targetUser.wins || 0,
                avatarUrl: targetUser.avatarUrl || '',
                bio: targetUser.bio || '',
                streakDays: targetUser.streakDays || 0,
            },
            gallery,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limitNum,
                hasMore,
            }
        });

    } catch (e) {
        console.error('PROFILE_GALLERY_ERROR', e);
        res.status(500).json({
            success: false,
            message: 'Failed to load gallery'
        });
    }
});

/**
 * PUT /api/profile/me
 * Update logged-in user's profile
 *  FIXED: Better validation and error handling
 */
router.put('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstName, avatarUrl, bio, username } = req.body;

        //  Validate required fields if provided
        if (firstName !== undefined && typeof firstName !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'firstName must be a string'
            });
        }

        if (username !== undefined && typeof username !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'username must be a string'
            });
        }

        if (bio !== undefined && typeof bio !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'bio must be a string'
            });
        }

        //  Validate username format and uniqueness if provided
        if (username !== undefined) {
            // Check format: alphanumeric, underscore, hyphen only
            if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
                return res.status(400).json({
                    success: false,
                    message: 'Username must be 3-30 characters and contain only letters, numbers, underscores, or hyphens'
                });
            }

            // Check if username is already taken by another user
            const existingUser = await User.findOne({
                username,
                _id: { $ne: userId }
            });

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken'
                });
            }
        }

        //  Build update fields object (only include defined fields)
        const updateFields = {};
        if (firstName !== undefined) updateFields.firstName = firstName.trim();
        if (username !== undefined) updateFields.username = username.trim().toLowerCase();
        if (bio !== undefined) updateFields.bio = bio.trim();
        if (avatarUrl !== undefined) updateFields.avatarUrl = avatarUrl.trim();

        //  Check if there are actually fields to update
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        //  Update the user
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true, runValidators: true }
        )
            .select('-password -__v -resetPasswordToken -resetPasswordExpire')
            .lean();

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (e) {
        console.error('PROFILE_UPDATE_ERROR', e);

        //  Handle specific mongoose errors
        if (e.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: e.message
            });
        }

        if (e.code === 11000) { // Duplicate key error
            return res.status(400).json({
                success: false,
                message: 'Username is already taken'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
});

/**
 * DELETE /api/profile/me
 *  NEW: Delete user account
 */
router.delete('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { confirmPassword } = req.body;

        //  Validate password confirmation
        if (!confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password confirmation required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        //  Verify password
        const isPasswordValid = await user.comparePassword(confirmPassword);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid password'
            });
        }

        //  Soft delete: Archive user's content instead of hard delete
        await Promise.all([
            // Archive all user's files
            FileMeta.updateMany(
                { createdBy: userId },
                { $set: { archived: true } }
            ),
            // Delete user's likes and favorites
            Like.deleteMany({ userId }),
            Favorite.deleteMany({ userId }),
            // Mark user account as deleted
            User.findByIdAndUpdate(userId, {
                $set: {
                    deleted: true,
                    deletedAt: new Date(),
                    email: `deleted_${userId}@deleted.com`, // Prevent email reuse
                    username: `deleted_${userId}`,
                }
            })
        ]);

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (e) {
        console.error('PROFILE_DELETE_ERROR', e);
        res.status(500).json({
            success: false,
            message: 'Failed to delete account'
        });
    }
});

module.exports = router;