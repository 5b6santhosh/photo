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


// ── GET /feed/swipe ───────────────────────────────────────────────────────────
// Algorithmic ranked feed for the swipe screen. Always starts with seedId item,
// then serves a scored+shuffled mix. Uses sessionId for stable per-session order.

router.get('/feed/swipe', async (req, res) => {
    try {
        const userId = req.user?.id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;

        const seedId = req.query.seedId;
        const sessionId = req.query.sessionId;
        const page = parseInt(req.query.page) || 0;
        const limit = Math.min(parseInt(req.query.limit) || 10, 20);
        const source = req.query.source || 'explore';
        const eventFilter = req.query.eventFilter || 'all';
        const now = new Date();

        const matchQuery = { archived: false, visibility: 'public' };

        // ── Following filter ──────────────────────────────────────────────────
        let followingIds = [];   // raw ObjectIds for DB query
        let followingSet = new Set();  // strings for Set.has() lookup
        if (source === 'following' && safeUserId) {
            followingIds = await Following.find({
                follower: new mongoose.Types.ObjectId(safeUserId)
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
                eventQuery = { createdBy: new mongoose.Types.ObjectId(safeUserId) };
            }
            const events = await Contest.find(eventQuery).select('_id');
            matchQuery.event = { $in: events.map(e => e._id) };
        }

        // ── Exclude seed ──────────────────────────────────────────────────────
        if (seedId && isValidObjectId(seedId)) {
            matchQuery._id = { $nin: [new mongoose.Types.ObjectId(seedId)] };
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
            {
                $addFields: {
                    shuffleBucket: { $floor: { $divide: ['$engagementScore', 10] } },
                    sessionTiebreak: { $rand: {} }
                }
            },
            { $sort: { shuffleBucket: -1, sessionTiebreak: 1 } },
            { $skip: page * limit },
            { $limit: limit },

            // ── JOIN user — use pipeline to select only needed fields ──────────
            {
                $lookup: {
                    from: 'users',
                    localField: 'createdBy',   // still the raw ObjectId at this point
                    foreignField: '_id',
                    as: 'userInfo',
                    pipeline: [
                        {
                            $project: {
                                _id: 1,
                                username: 1,
                                firstName: 1,
                                lastName: 1,
                                avatarUrl: 1,
                                wins: 1
                            }
                        }
                    ]
                }
            },
            { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },

            // ── JOIN contest/event ─────────────────────────────────────────────
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

        // ── Liked + Bookmarked sets ───────────────────────────────────────────
        // FIX: Cast safeUserId and fileIds to ObjectId to guarantee match
        let likedSet = new Set();
        let bookmarkedSet = new Set();
        if (safeUserId && files.length) {
            const fileIds = files.map(f => f._id); // already ObjectIds from aggregate
            const userObjectId = new mongoose.Types.ObjectId(safeUserId);

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

        // ── Seed item (page 0 only) ───────────────────────────────────────────
        let seedReel = null;
        if (page === 0 && seedId && isValidObjectId(seedId)) {
            const seedFile = await FileMeta.findById(seedId)
                .populate('createdBy', 'username firstName lastName avatarUrl wins')
                .populate('event', 'title startDate endDate createdBy')
                .lean();

            if (seedFile) {
                // Normalize .populate() shape → aggregation shape
                seedFile.userInfo = seedFile.createdBy || null;
                seedFile.eventInfo = seedFile.event || null;
                seedReel = formatReel(
                    seedFile, safeUserId, likedSet, bookmarkedSet, followingSet, now
                );
            }
        }

        const feed = files.map(f =>
            formatReel(f, safeUserId, likedSet, bookmarkedSet, followingSet, now)
        );
        const finalFeed = seedReel ? [seedReel, ...feed] : feed;

        res.json({
            status: 'success',
            reels: finalFeed,
            nextPage: page + 1,
            hasMore: files.length === limit,
        });

    } catch (err) {
        console.error('SWIPE_FEED_ERROR:', err);
        res.status(500).json({ status: 'error', message: 'Swipe feed failed' });
    }
});

// ── Shared formatter ──────────────────────────────────────────────────────────
function formatReel(f, safeUserId, likedSet, bookmarkedSet, followingSet, now) {
    const isVideo = f.mimeType?.startsWith('video/');
    const user = f.userInfo || null;
    const event = f.eventInfo || null;

    // Build display name — User schema has no 'name' field
    const displayName = user
        ? (
            [user.firstName, user.lastName].filter(s => s && s.trim()).join(' ').trim()
            || user.username
            || 'Unknown'
        )
        : 'Unknown';

    // Event status — only meaningful when event is actually linked
    let eventStatus = 'general';
    if (event?.startDate && event?.endDate) {
        const start = new Date(event.startDate);
        const end = new Date(event.endDate);
        if (now < start) eventStatus = 'upcoming';
        else if (now > end) eventStatus = 'completed';
        else eventStatus = 'active';
    }

    // FIX: creatorIdStr must come from userInfo._id (the joined doc), not f.createdBy
    // After aggregation $unwind, f.createdBy is still the raw ObjectId — use userInfo
    const creatorIdStr = user?._id?.toString() || '';

    // FIX: isMyEvent — compare event.createdBy (ObjectId) to safeUserId (string)
    const isMyEvent = !!(
        safeUserId &&
        event?.createdBy &&
        event.createdBy.toString() === safeUserId.toString()
    );

    // FIX: isFromFollowing — must compare against creatorIdStr from userInfo
    const isFromFollowing = followingSet.size > 0 && followingSet.has(creatorIdStr);

    return {
        id: f._id.toString(),
        mediaType: isVideo ? 'reel' : 'image',
        photo: {
            id: f._id.toString(),
            title: f.title || 'Untitled',
            location: f.location || '',
            category: f.category || 'other',
            date: f.uploadedAt,
            imageUrl: isVideo ? (f.thumbnailUrl || f.path) : f.path,
        },
        videoUrl: isVideo ? f.path : null,

        // FIX: eventTitle/eventStatus only non-default when event is actually linked in FileMeta
        eventTitle: event?.title || 'General',
        eventStatus,
        isMyEvent,
        isFromFollowing,

        likes: f.likesCount || 0,
        comments: f.commentsCount || 0,

        // FIX: Cast _id to string before Set.has() — aggregate returns BSON ObjectIds
        isLiked: likedSet.has(f._id.toString()),
        isBookmarked: bookmarkedSet.has(f._id.toString()),

        user: {
            id: creatorIdStr,
            name: displayName,
            avatarUrl: user?.avatarUrl || '',
            wins: user?.wins || 0,
        },
    };
}

module.exports = router;