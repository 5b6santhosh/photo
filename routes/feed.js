const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const Favorite = require('../models/Favorite');
const Following = require('../models/Following');
const { authMiddleware } = require('../middleware/auth');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();
    return authMiddleware(req, res, next);
};

const formatReel = (file, safeUserId, likedSet, bookmarkedSet, followingSet, now) => {
    const isVideo = file.mimeType?.startsWith('video/') ?? false;
    const createdById = file.userInfo?._id ? String(file.userInfo._id) : null;

    let eventStatus = 'general';
    if (file.eventInfo) {
        const start = file.eventInfo.startDate ? new Date(file.eventInfo.startDate) : null;
        const end = file.eventInfo.endDate ? new Date(file.eventInfo.endDate) : null;
        if (start && end && !isNaN(start) && !isNaN(end)) {
            if (now < start) eventStatus = 'upcoming';
            else if (now > end) eventStatus = 'completed';
            else eventStatus = 'active';
        }
    }

    return {
        id: String(file._id),
        mediaType: isVideo ? 'reel' : 'image',
        photo: {
            id: String(file._id),
            title: file.title || 'Untitled',
            imageUrl: isVideo ? (file.thumbnailUrl || null) : (file.path || null),
            category: file.category || 'other',
        },
        videoUrl: isVideo ? (file.path || null) : null,
        eventTitle: file.eventInfo?.title || 'General',
        eventStatus,
        isMyEvent: !!(safeUserId && file.eventInfo?.createdBy?.toString() === safeUserId.toString()),
        isFromFollowing: !!(createdById && followingSet?.has(createdById)),
        isSubmission: file.isSubmission || false,
        likes: file.likesCount || 0,
        comments: file.commentsCount || 0,
        shares: file.sharesCount || 0,
        isLiked: likedSet?.has(String(file._id)) || false,
        isBookmarked: bookmarkedSet?.has(String(file._id)) || false,
        user: {
            id: createdById,
            username: file.userInfo?.username || file.userInfo?.name || 'Anonymous',
            firstName: file.userInfo?.firstName || '',
            lastName: file.userInfo?.lastName || '',
            name: file.userInfo?.name || `${file.userInfo?.firstName || ''} ${file.userInfo?.lastName || ''}`.trim() || 'Anonymous',
            avatarUrl: file.userInfo?.avatarUrl || '',
            bio: file.userInfo?.bio || '',
            wins: file.userInfo?.wins || 0,
            streakDays: file.userInfo?.streakDays || 0,
            location: file.userInfo?.location || '',
            badgeTier: file.userInfo?.badgeTier || null,
            isProfileCompleted: file.userInfo?.isProfileCompleted || false,
        },
        uploadedAt: file.uploadedAt,
        freshnessBoost: file.freshnessBoost,
        engagementScore: file.engagementScore,
    };
};

router.get('/feed', optionalAuth, async (req, res) => {
    try {
        console.log('[FEED] req.user:', req.user);
        const userId = req.user?.id ?? req.user?._id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;

        const page = parseInt(req.query.page) || 0;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const source = req.query.source || 'explore';
        const eventFilter = req.query.eventFilter || 'all';
        const now = new Date();

        const matchQuery = { archived: false, visibility: 'public' };

        // ── Following filter ────────────────────────────────────────────────
        let followingIds = [];
        let followingSet = new Set();
        if (source === 'following' && safeUserId) {
            followingIds = await Following.find({
                follower: new ObjectId(safeUserId)
            }).distinct('following');
            followingSet = new Set(followingIds.map(id => id.toString()));
            matchQuery.createdBy = { $in: followingIds };
        }

        // ── Event filter ──────────────────────────────────────────────────────
        if (eventFilter !== 'all') {
            let eventQuery = {};
            if (eventFilter === 'active') eventQuery = { startDate: { $lte: now }, endDate: { $gte: now } };
            if (eventFilter === 'upcoming') eventQuery = { startDate: { $gt: now } };
            if (eventFilter === 'completed') eventQuery = { endDate: { $lt: now } };
            if (eventFilter === 'myEvents' && safeUserId) {
                eventQuery = { createdBy: new ObjectId(safeUserId) };
            }
            const Contest = require('../models/Contest');
            const events = await Contest.find(eventQuery).select('_id');
            matchQuery.event = { $in: events.map(e => e._id) };
        }

        // ── Scored + ranked aggregation ───────────────────────────────────────
        const files = await FileMeta.aggregate([
            { $match: matchQuery },
            {
                $addFields: {
                    freshnessBoost: {
                        $max: [0, {
                            $subtract: [
                                30,
                                { $divide: [{ $subtract: [now, '$uploadedAt'] }, 86400000] }
                            ]
                        }]
                    }
                }
            },
            {
                $addFields: {
                    engagementScore: {
                        $add: [
                            { $multiply: [{ $ifNull: ['$likesCount', 0] }, 3] },
                            { $multiply: [{ $ifNull: ['$commentsCount', 0] }, 2] },
                            { $ifNull: ['$sharesCount', 0] },
                            '$freshnessBoost'
                        ]
                    }
                }
            },
            { $sort: { engagementScore: -1, uploadedAt: -1 } },
            { $skip: page * limit },
            { $limit: limit },

            // ── JOIN user ───────────────────────────────────────────────────
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
                                name: 1,
                                email: 1,
                                avatarUrl: 1,
                                bio: 1,
                                dateOfBirth: 1,
                                gender: 1,
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

            // ── JOIN contest/event ────────────────────────────────────────
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
                                createdBy: 1
                            }
                        }
                    ]
                }
            },
            { $unwind: { path: '$eventInfo', preserveNullAndEmptyArrays: true } },
        ]);

        // ── Liked + Bookmarked sets ─────────────────────────────────────────
        let likedSet = new Set();
        let bookmarkedSet = new Set();
        if (safeUserId && files.length) {
            const fileIds = files.map(f => f._id);
            const userObjectId = new ObjectId(safeUserId);

            const [liked, favorites] = await Promise.all([
                Like.find({
                    userId: userObjectId,
                    fileId: { $in: fileIds }
                }).distinct('fileId'),
                Favorite.find({
                    userId: userObjectId,
                    fileId: { $in: fileIds }
                }).distinct('fileId'),
            ]);
            likedSet = new Set(liked.map(id => id.toString()));
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }

        // ── Build feed ──────────────────────────────────────────────────────
        const feed = files.map(f =>
            formatReel(f, safeUserId, likedSet, bookmarkedSet, followingSet, now)
        );

        const followingCount = feed.filter(i => i.isFromFollowing).length;
        console.log(`[FEED] total=${feed.length}, fromFollowing=${followingCount}, userId=${safeUserId}`);

        return res.status(200).json({
            status: 'success',
            count: feed.length,
            reels: feed,
            nextPage: page + 1,
            hasMore: files.length === limit,
        });

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