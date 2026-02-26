const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const Following = require('../models/Following');
const Contest = require('../models/Contest');
const Favorite = require('../models/Favorite');
const cloudinary = require('cloudinary').v2;

// ── Helper ────────────────────────────────────────────────────────────────────
const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

// ── GET /trending ─────────────────────────────────────────────────────────────
router.get('/trending', async (req, res) => {
    try {
        const userId = req.user?.id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;
        const now = new Date();

        const reels = await FileMeta.aggregate([
            {
                $match: {
                    archived: false,
                    isCurated: true,
                    visibility: 'public',
                    mimeType: { $regex: '^video/' }
                }
            },
            {
                $addFields: {
                    freshnessScore: {
                        $divide: [{ $subtract: [now, '$uploadedAt'] }, -86400000]
                    }
                }
            },
            {
                $addFields: {
                    score: {
                        $add: [
                            { $multiply: ['$likesCount', 2] },
                            '$commentsCount',
                            '$sharesCount',
                            '$freshnessScore'
                        ]
                    }
                }
            },
            { $sort: { score: -1 } },
            { $limit: 20 },
            {
                $lookup: {
                    from: 'users',
                    localField: 'createdBy',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    path: 1,
                    likesCount: 1,
                    score: 1,
                    userName: { $ifNull: ['$user.name', 'Curator'] }
                }
            }
        ]);

        let bookmarkedSet = new Set();
        if (safeUserId && reels.length) {
            const favorites = await Favorite.find({
                userId: safeUserId,
                fileId: { $in: reels.map(r => r._id) }
            }).distinct('fileId');
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }

        res.json(
            reels.map(r => ({
                id: r._id.toString(),
                imageUrl: r.path,
                likes: r.likesCount,
                score: Math.round(r.score),
                userName: r.userName,
                isBookmarked: bookmarkedSet.has(r._id.toString()),
            }))
        );
    } catch (err) {
        console.error('TRENDING_REELS_ERROR:', err);
        res.status(500).json({ message: 'Trending reels failed' });
    }
});

// ── GET /curators/:id/reels ───────────────────────────────────────────────────
router.get('/curators/:id/reels', async (req, res) => {
    try {
        const userId = req.user?.id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;
        const curatorId = req.params.id;

        // Guard against invalid curatorId too
        if (!isValidObjectId(curatorId)) {
            return res.status(400).json({ status: 'error', message: 'Invalid curator ID' });
        }

        const reels = await FileMeta.find({
            archived: false,
            visibility: 'public',
            isCurated: true,
            createdBy: curatorId,
        })
            .sort({ likesCount: -1, uploadedAt: -1 })
            .limit(60)
            .populate('createdBy', 'name avatarUrl wins')
            .lean();

        let bookmarkedSet = new Set();
        if (safeUserId && reels.length) {
            const favorites = await Favorite.find({
                userId: safeUserId,
                fileId: { $in: reels.map(r => r._id) }
            }).distinct('fileId');
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }

        const formatted = reels.map((r) => ({
            id: r._id.toString(),
            mediaType: r.isVideo ? 'reel' : 'image',
            photo: {
                id: r._id.toString(),
                title: r.title || 'Untitled',
                location: r.location || null,
                date: r.uploadedAt,
                category: r.category || 'other',
                imageUrl: r.isVideo ? r.thumbnailUrl : r.path,
                isFavorite: false,
            },
            videoUrl: r.isVideo ? r.path : null,
            user: {
                id: r.createdBy?._id?.toString() || '',
                name: r.createdBy?.name || 'Curator',
                avatarUrl: r.createdBy?.avatarUrl || '',
                wins: r.createdBy?.wins || 0,
            },
            eventTitle: r.event || 'General',
            likes: r.likesCount || 0,
            comments: r.commentsCount || 0,
            isLiked: false,
            isBookmarked: bookmarkedSet.has(r._id.toString()),
        }));

        res.json({ status: 'success', reels: formatted });
    } catch (e) {
        console.error('CURATOR_REELS_ERROR:', e);
        res.status(500).json({ status: 'error', message: 'Failed to load reels' });
    }
});

// ── GET /feed/infinite ────────────────────────────────────────────────────────
router.get('/feed/infinite', async (req, res) => {
    try {
        const userId = req.user?.id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;  // ← KEY FIX

        const limit = Math.min(parseInt(req.query.limit) || 10, 20);
        const source = req.query.source || 'explore';
        const eventFilter = req.query.eventFilter || 'all';
        const cursor = req.query.cursor ? JSON.parse(req.query.cursor) : null;

        const query = { archived: false, visibility: 'public' };

        // ── Cursor pagination ─────────────────────────────────────────────────
        if (cursor) {
            query.$and = [{
                $or: [
                    { uploadedAt: { $lt: new Date(cursor.date) } },
                    { uploadedAt: new Date(cursor.date), _id: { $lt: cursor.id } },
                ],
            }];
        }

        // ── Following filter ──────────────────────────────────────────────────
        let followingSet = new Set();
        if (source === 'following' && safeUserId) {
            const ids = await Following.find({ follower: safeUserId }).distinct('following');
            followingSet = new Set(ids.map(id => id.toString()));
            query.createdBy = { $in: [...followingSet] };
        }

        // ── Event filter ──────────────────────────────────────────────────────
        if (eventFilter !== 'all') {
            const now = new Date();
            let eventQuery = {};

            if (eventFilter === 'active') {
                eventQuery = { startDate: { $lte: now }, endDate: { $gte: now } };
            } else if (eventFilter === 'upcoming') {
                eventQuery = { startDate: { $gt: now } };
            } else if (eventFilter === 'completed') {
                eventQuery = { endDate: { $lt: now } };
            } else if (eventFilter === 'myEvents' && safeUserId) {
                eventQuery = { createdBy: safeUserId };
            }

            const events = await Contest.find(eventQuery).select('_id');
            const eventIds = events.map(e => e._id);
            query.$and = query.$and || [];
            query.$and.push({ $or: [{ event: { $in: eventIds } }, { event: null }] });
        }

        // ── Fetch files ───────────────────────────────────────────────────────
        const files = await FileMeta.find(query)
            .populate({
                path: 'createdBy',
                select: 'name avatarUrl wins',
                transform: (doc, id) => {
                    if (!isValidObjectId(id?.toString())) return null;
                    return doc;
                }
            })
            .populate({
                path: 'event',
                select: 'title startDate endDate createdBy',
                transform: (doc, id) => {
                    if (!isValidObjectId(id?.toString())) return null;
                    return doc;
                }
            })
            .sort({ uploadedAt: -1, _id: -1 })
            .limit(limit)
            .lean();

        // ── Liked set ─────────────────────────────────────────────────────────
        let likedSet = new Set();
        if (safeUserId && files.length) {
            const liked = await Like.find({
                userId: safeUserId,
                fileId: { $in: files.map(f => f._id) },
            }).distinct('fileId');
            likedSet = new Set(liked.map(id => id.toString()));
        }

        // ── Bookmarked set ────────────────────────────────────────────────────
        let bookmarkedSet = new Set();
        if (safeUserId && files.length) {
            const favorites = await Favorite.find({
                userId: safeUserId,
                fileId: { $in: files.map(f => f._id) },
            }).distinct('fileId');
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }

        // ── Build response ────────────────────────────────────────────────────
        const feed = files.map(f => {
            const isVideo = f.mimeType?.startsWith('video/');
            let imageUrl = f.path;

            if (isVideo) {
                imageUrl = f.thumbnailUrl ||
                    cloudinary.url(f.cloudId, {
                        resource_type: 'video',
                        format: 'jpg',
                        transformation: [{ width: 400, crop: 'scale' }],
                    });
            }

            let eventStatus = 'general';
            if (f.event) {
                const now = new Date();
                if (now < f.event.startDate) eventStatus = 'upcoming';
                else if (now > f.event.endDate) eventStatus = 'completed';
                else eventStatus = 'active';
            }

            return {
                id: f._id.toString(),
                mediaType: isVideo ? 'reel' : 'image',
                photo: {
                    id: f._id.toString(),
                    title: f.title || 'Untitled',
                    location: f.location || '',
                    category: f.category || 'other',
                    date: f.uploadedAt,
                    imageUrl,
                },
                videoUrl: isVideo ? f.path : null,
                eventTitle: f.event?.title || 'General',
                eventStatus,
                isMyEvent: !!(safeUserId && f.event?.createdBy?.toString() === safeUserId),
                isFromFollowing: followingSet.has(f.createdBy?._id?.toString()),
                isSubmission: f.isSubmission || false,
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: likedSet.has(f._id.toString()),
                user: {
                    id: f.createdBy?._id?.toString() || '',
                    name: f.createdBy?.name || 'Curator',
                    avatarUrl: f.createdBy?.avatarUrl || '',
                    wins: f.createdBy?.wins || 0,
                },
                isBookmarked: bookmarkedSet.has(f._id.toString()),
            };
        });

        const last = files[files.length - 1];
        const nextCursor = last
            ? JSON.stringify({ date: last.uploadedAt.toISOString(), id: last._id.toString() })
            : null;

        res.json({ status: 'success', reels: feed, nextCursor, hasMore: feed.length === limit });

    } catch (err) {
        console.error('INFINITE_FEED_ERROR:', err);
        res.status(500).json({ status: 'error', message: 'Feed failed' });
    }
});

module.exports = router;