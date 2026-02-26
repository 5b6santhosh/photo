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
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Count all photos (including private ones for own profile)
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
                dateOfBirth: user.dateOfBirth || null,
                gender: user.gender || null,
                totalPhotos,
                wins: user.wins || 0,
                streakDays: user.streakDays || 0,
                location: user.location || {
                    city: '',
                    state: '',
                    country: '',
                    countryCode: '',
                    latitude: null,
                    longitude: null,
                    lastUpdated: null
                },
                isProfileCompleted: user.isProfileCompleted || false,
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
 */
router.get('/:userId', optionalAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const viewerId = req.user?.id;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid userId'
            });
        }

        const user = await User.findById(userId)
            .select('name firstName username avatarUrl bio wins streakDays location')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // If viewing own profile, show all photos; otherwise show only public
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
                dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).getFullYear() : null,
                gender: user.gender || null,

                totalPhotos,
                wins: user.wins || 0,
                streakDays: user.streakDays || 0,
                isOwnProfile: viewerId === userId,
                location: user.location || {
                    city: '',
                    state: '',
                    country: '',
                    countryCode: '',
                    latitude: null,
                    longitude: null
                }
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
 * Returns full Reel objects for user's content
 */
router.get('/:userId/gallery', optionalAuth, async (req, res) => {
    try {
        const viewerId = req.user?.id;
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid userId' });
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;

        // ── Fetch target user ─────────────────────────────────────────────────
        const targetUser = await User.findById(userId)
            .select('name firstName avatarUrl bio wins streakDays location')
            .lean();

        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // ── Build file query ──────────────────────────────────────────────────
        const galleryQuery = { createdBy: userId, archived: false };
        if (!viewerId || viewerId !== userId) {
            galleryQuery.visibility = 'public';
        }

        const totalCount = await FileMeta.countDocuments(galleryQuery);

        // ── Fetch files WITHOUT populate (safe) ───────────────────────────────
        const files = await FileMeta.find(galleryQuery)
            .sort({ uploadedAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const emptyPagination = {
            currentPage: pageNum,
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: limitNum,
            hasMore: false,
        };

        if (files.length === 0) {
            return res.json({
                success: true,
                user: _formatUser(targetUser),
                gallery: [],
                pagination: emptyPagination,
            });
        }

        // ── Safely resolve event refs ─────────────────────────────────────────
        const eventIdStrings = [...new Set(
            files
                .map(f => f.event?.toString())
                .filter(id => mongoose.Types.ObjectId.isValid(id))
        )];

        const eventMap = {};
        if (eventIdStrings.length) {
            const Contest = require('../models/Contest');
            const events = await Contest.find(
                { _id: { $in: eventIdStrings.map(id => new mongoose.Types.ObjectId(id)) } },
                'title'
            ).lean();
            events.forEach(e => { eventMap[e._id.toString()] = e; });
        }

        // ── Liked / bookmarked sets ───────────────────────────────────────────
        let likedSet = new Set();
        let bookmarkedSet = new Set();

        if (viewerId && mongoose.Types.ObjectId.isValid(viewerId)) {
            const fileIds = files.map(f => f._id);
            const [likes, favs] = await Promise.all([
                Like.find({ userId: viewerId, fileId: { $in: fileIds } }).distinct('fileId'),
                Favorite.find({ userId: viewerId, fileId: { $in: fileIds } }).distinct('fileId'),
            ]);
            likedSet = new Set(likes.map(id => id.toString()));
            bookmarkedSet = new Set(favs.map(id => id.toString()));
        }

        // ── Build gallery ─────────────────────────────────────────────────────
        // We use targetUser for creator info since all files belong to the same user
        const gallery = files.map(f => {
            const isVideo = f.mimeType?.startsWith('video/');
            const eventId = f.event?.toString();
            const event = mongoose.Types.ObjectId.isValid(eventId) ? (eventMap[eventId] ?? null) : null;
            const location = targetUser.location || {};

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
                    id: targetUser._id.toString(),
                    name: targetUser.name || targetUser.firstName || 'Curator',
                    avatarUrl: targetUser.avatarUrl || '',
                    wins: targetUser.wins || 0,
                    location: {
                        city: location.city || '',
                        state: location.state || '',
                        country: location.country || '',
                        countryCode: location.countryCode || '',
                    },
                },
                eventTitle: event?.title || 'General',
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: likedSet.has(f._id.toString()),
                isBookmarked: bookmarkedSet.has(f._id.toString()),
                visibility: f.visibility || 'public',
            };
        });

        res.json({
            success: true,
            user: _formatUser(targetUser),
            gallery,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(totalCount / limitNum),
                totalItems: totalCount,
                itemsPerPage: limitNum,
                hasMore: pageNum < Math.ceil(totalCount / limitNum),
            },
        });

    } catch (e) {
        console.error('PROFILE_GALLERY_ERROR', e);
        res.status(500).json({ success: false, message: 'Failed to load gallery' });
    }
});

// ── Small helper to avoid repeating the user shape ───────────────────────────
function _formatUser(u) {
    return {
        id: u._id,
        name: u.name || u.firstName || 'Curator',
        wins: u.wins || 0,
        avatarUrl: u.avatarUrl || '',
        dateOfBirth: u.dateOfBirth ? new Date(u.dateOfBirth).toISOString() : null, // ← full ISO string
        gender: u.gender || null,
        bio: u.bio || '',
        streakDays: u.streakDays || 0,
        location: u.location || { city: '', state: '', country: '', countryCode: '' },
    };
}

/**
 * PUT /api/profile/me
 * Update logged-in user's profile (WITH LOCATION SUPPORT)
 */
router.put('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            firstName,
            avatarUrl,
            bio,
            username,
            dateOfBirth,
            gender,
            country,
            state,
            city,
            countryCode,
            country_code, // Support both formats
            latitude,
            longitude,
            locationSource // 'gps' or 'manual'
        } = req.body;

        // Validate required fields if provided
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
        if (dateOfBirth !== undefined) {
            const dob = new Date(dateOfBirth);
            if (isNaN(dob.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'dateOfBirth must be a valid date'
                });
            }
            // Check minimum age (18 years)
            const minAge = new Date();
            minAge.setFullYear(minAge.getFullYear() - 18);
            if (dob > minAge) {
                return res.status(400).json({
                    success: false,
                    message: 'You must be at least 18 years old'
                });
            }
        }

        if (gender !== undefined && !['Male', 'Female', 'Other'].includes(gender)) {
            return res.status(400).json({
                success: false,
                message: 'gender must be Male, Female, or Other'
            });
        }


        // Validate location fields if provided
        // Support both camelCase and snake_case from Flutter
        const locCountry = country !== undefined ? country : undefined;
        const locState = state !== undefined ? state : undefined;
        const locCity = city !== undefined ? city : undefined;
        const locCountryCode = countryCode !== undefined ? countryCode : country_code;

        if (locCountry !== undefined && typeof locCountry !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'country must be a string'
            });
        }

        if (locState !== undefined && typeof locState !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'state must be a string'
            });
        }

        if (locCity !== undefined && typeof locCity !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'city must be a string'
            });
        }

        if (locCountryCode !== undefined && typeof locCountryCode !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'countryCode must be a string'
            });
        }

        if (latitude !== undefined && (typeof latitude !== 'number' || isNaN(latitude))) {
            return res.status(400).json({
                success: false,
                message: 'latitude must be a valid number'
            });
        }

        if (longitude !== undefined && (typeof longitude !== 'number' || isNaN(longitude))) {
            return res.status(400).json({
                success: false,
                message: 'longitude must be a valid number'
            });
        }

        // Validate username format and uniqueness if provided
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

        // Build update fields object (only include defined fields)
        const updateFields = {};
        if (firstName !== undefined) updateFields.firstName = firstName.trim();
        if (username !== undefined) updateFields.username = username.trim().toLowerCase();
        if (bio !== undefined) updateFields.bio = bio.trim();
        if (avatarUrl !== undefined) updateFields.avatarUrl = avatarUrl.trim();
        if (dateOfBirth !== undefined) updateFields.dateOfBirth = new Date(dateOfBirth);
        if (gender !== undefined) updateFields.gender = gender;

        if (firstName || avatarUrl || bio || dateOfBirth || gender) {
            updateFields.isProfileCompleted = true;
        }
        // Build location update if any location field is provided
        const locationUpdate = {};
        if (locCountry !== undefined) locationUpdate['location.country'] = locCountry.trim();
        if (locState !== undefined) locationUpdate['location.state'] = locState.trim();
        if (locCity !== undefined) locationUpdate['location.city'] = locCity.trim();
        if (locCountryCode !== undefined) locationUpdate['location.countryCode'] = locCountryCode.trim().toUpperCase();
        if (latitude !== undefined) locationUpdate['location.latitude'] = latitude;
        if (longitude !== undefined) locationUpdate['location.longitude'] = longitude;
        if (locationSource !== undefined) locationUpdate['location.source'] = locationSource;

        // Always update the lastUpdated timestamp if any location field is provided
        if (Object.keys(locationUpdate).length > 0) {
            locationUpdate['location.lastUpdated'] = new Date();
        }

        // Merge location updates into updateFields
        Object.assign(updateFields, locationUpdate);

        // Check if there are actually fields to update
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        // Update the user
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
            user: {
                ...updatedUser,
                location: updatedUser.location || {
                    city: '',
                    state: '',
                    country: '',
                    countryCode: '',
                    latitude: null,
                    longitude: null,
                    source: null,
                    lastUpdated: null
                },
                isProfileCompleted: updatedUser.isProfileCompleted || false,
            }
        });
    } catch (e) {
        console.error('PROFILE_UPDATE_ERROR', e);

        // Handle specific mongoose errors
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
 * Delete user account
 */
router.delete('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { confirmPassword } = req.body;

        // Validate password confirmation
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

        // Verify password
        const isPasswordValid = await user.comparePassword(confirmPassword);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid password'
            });
        }

        // Soft delete: Archive user's content instead of hard delete
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
                    email: `deleted_${userId}@deleted.com`,
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

/**
 * PUT /api/profile/me/location
 * Dedicated endpoint for updating location only
 */
router.put('/me/location', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            country,
            state,
            city,
            countryCode,
            country_code,
            latitude,
            longitude,
            source
        } = req.body;

        // Support both snake_case and camelCase
        const locCountry = country || req.body.country;
        const locCountryCode = countryCode || country_code;

        // Validate required fields
        if (!locCountry || !city) {
            return res.status(400).json({
                success: false,
                message: 'Country and city are required'
            });
        }

        // Validate types
        if (typeof locCountry !== 'string' || typeof city !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Country and city must be strings'
            });
        }

        const updateFields = {
            'location.country': locCountry.trim(),
            'location.city': city.trim(),
            'location.lastUpdated': new Date()
        };

        if (state !== undefined) updateFields['location.state'] = state.trim();
        if (locCountryCode !== undefined) updateFields['location.countryCode'] = locCountryCode.trim().toUpperCase();
        if (latitude !== undefined) updateFields['location.latitude'] = latitude;
        if (longitude !== undefined) updateFields['location.longitude'] = longitude;
        if (source !== undefined) updateFields['location.source'] = source;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true, runValidators: true }
        )
            .select('location firstName gender dateOfBirth instagram')
            .lean();

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Location updated successfully',
            user: {
                firstName: updatedUser.firstName || '',
                gender: updatedUser.gender || null,
                dateOfBirth: updatedUser.dateOfBirth ? new Date(updatedUser.dateOfBirth).getFullYear() : null,
                instagram: updatedUser.instagram || '',
                location: updatedUser.location
            }
        });
    } catch (e) {
        console.error('LOCATION_UPDATE_ERROR', e);
        res.status(500).json({
            success: false,
            message: 'Failed to update location'
        });
    }
});

module.exports = router;