const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const Favorite = require('../models/Favorite');
const Following = require('../models/Following');
const Contest = require('../models/Contest');
const { authMiddleware } = require('../middleware/auth');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();
    return authMiddleware(req, res, next);
};

router.get('/feed', optionalAuth, async (req, res) => {
    try {
        console.log('[FEED] req.user:', req.user);
        const userId = req.user?.id ?? req.user?._id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;
        const now = new Date();

        // ── 1. Fetch public files via aggregation (mirrors swipe feed) ─────────
        const files = await FileMeta.aggregate([
            { $match: { archived: false, visibility: 'public' } },
            { $sort: { uploadedAt: -1 } },
            { $limit: 100 },

            // ── JOIN user — same pipeline as swipe feed ───────────────────────
            {
                $lookup: {
                    from: 'users',
                    localField: 'createdBy',
                    foreignField: '_id',
                    as: 'userInfo',
                    pipeline: [
                        {
                            $project: {
                                _id: 1,
                                username: 1,
                                firstName: 1,
                                lastName: 1,
                                email: 1,
                                avatarUrl: 1,
                                bio: 1,
                                wins: 1,
                                streakDays: 1,
                                location: 1,
                                isProfileCompleted: 1,
                                badgeTier: 1,
                            }
                        }
                    ]
                }
            },
            { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },

            // ── JOIN contest/event ────────────────────────────────────────────
            {
                $lookup: {
                    from: 'contests',
                    localField: 'event',
                    foreignField: '_id',
                    as: 'eventInfo',
                    pipeline: [
                        {
                            $project: {
                                _id: 1,
                                title: 1,
                                startDate: 1,
                                endDate: 1,
                                createdBy: 1,
                                contestStatus: 1,
                            }
                        }
                    ]
                }
            },
            { $unwind: { path: '$eventInfo', preserveNullAndEmptyArrays: true } },
        ]);

        // ── 2. Who does this user follow? ──────────────────────────────────────
        let followingSet = new Set();
        if (safeUserId) {
            try {
                const followingDocs = await Following.find({
                    follower: new ObjectId(safeUserId)
                }).select('following').lean();

                followingSet = new Set(
                    followingDocs
                        .map(doc => doc.following?.toString())
                        .filter(Boolean)
                );
                console.log(`[FEED] userId=${safeUserId} follows ${followingSet.size} users`);
            } catch (followErr) {
                console.error('[FEED] Error fetching following list:', followErr.message);
            }
        }

        // ── 3. Liked + Bookmarked sets ─────────────────────────────────────────
        let likedSet = new Set();
        let bookmarkedSet = new Set();
        if (safeUserId && files.length) {
            const fileIds = files.map(f => f._id);
            const userObjectId = new ObjectId(safeUserId);

            const [liked, favorites] = await Promise.all([
                Like.find({ userId: userObjectId, fileId: { $in: fileIds } }).distinct('fileId'),
                Favorite.find({ userId: userObjectId, fileId: { $in: fileIds } }).distinct('fileId'),
            ]);
            likedSet = new Set(liked.map(id => id.toString()));
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }

        // ── 4. Build feed items ────────────────────────────────────────────────
        const feed = files.map(f => {
            if (!f._id) return null;

            const fileId = f._id.toString();
            const isVideo = f.mimeType?.startsWith('video/') ?? false;
            const user = f.userInfo ?? null;
            const event = f.eventInfo ?? null;

            // Event status
            let eventStatus = 'general';
            if (event) {
                const start = event.startDate ? new Date(event.startDate) : null;
                const end = event.endDate ? new Date(event.endDate) : null;
                if (start && end && !isNaN(start) && !isNaN(end)) {
                    if (now < start) eventStatus = 'upcoming';
                    else if (now > end) eventStatus = 'completed';
                    else eventStatus = 'active';
                }
            }

            const creatorIdStr = user?._id?.toString() ?? null;
            const isFromFollowing = !!(creatorIdStr && followingSet.has(creatorIdStr));
            const isMyEvent = !!(safeUserId && event?.createdBy?.toString() === safeUserId.toString());

            return {
                id: fileId,
                mediaType: isVideo ? 'reel' : 'image',
                photo: {
                    id: fileId,
                    title: f.title || 'Untitled',
                    imageUrl: isVideo ? (f.thumbnailUrl || null) : (f.path || null),
                    category: f.category || 'other',
                },
                videoUrl: isVideo ? (f.path || null) : null,
                eventTitle: event?.title || 'General',
                eventStatus,
                isMyEvent,
                isFromFollowing,
                isSubmission: f.isSubmission || false,
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: likedSet.has(fileId),
                isBookmarked: bookmarkedSet.has(fileId),
                user: user ? {
                    id: creatorIdStr,
                    username: user.username || null,
                    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Anonymous',
                    firstName: user.firstName || null,
                    lastName: user.lastName || null,
                    avatarUrl: user.avatarUrl || '',
                    bio: user.bio || null,
                    wins: user.wins || 0,
                    streakDays: user.streakDays || 0,
                    badgeTier: user.badgeTier || null,
                    isProfileCompleted: user.isProfileCompleted || false,
                } : {
                    id: null,
                    name: 'Anonymous',
                    avatarUrl: '',
                },
            };
        }).filter(Boolean);

        const followingCount = feed.filter(i => i.isFromFollowing).length;
        console.log(`[FEED] total=${feed.length}, fromFollowing=${followingCount}, userId=${safeUserId}`);

        return res.status(200).json({ status: 'success', count: feed.length, feed });

    } catch (e) {
        console.error('FEED_API_ERROR:', e.message, e.stack);
        return res.status(500).json({
            status: 'error',
            message: 'Feed error',
            ...(process.env.NODE_ENV !== 'production' && { detail: e.message })
        });
    }
});

module.exports = router;