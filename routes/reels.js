// routes/reels.js
const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');
const cloudinary = require('cloudinary').v2;

router.get('/trending', async (req, res) => {
    try {
        const now = new Date();

        const reels = await FileMeta.aggregate([
            {
                $match: {
                    archived: false,
                    isCurated: true,
                    visibility: 'public',
                    mimeType: { $regex: '^video/' } // Only videos
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
            {
                $unwind: { path: '$user', preserveNullAndEmptyArrays: true }
            },
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
        if (userId) {
            const favorites = await Favorite.find({
                userId,
                fileId: { $in: reels.map(r => r._id) }
            }).distinct('fileId');
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }


        res.json(
            reels.map(r => ({
                id: r._id.toString(),
                imageUrl: r.path, //  Cloud video URL (works for thumbnails too)
                likes: r.likesCount,
                score: Math.round(r.score),
                userName: r.userName,
                isBookmarked: bookmarkedSet.has(r._id.toString()), //  Only if needed

            }))
        );
    } catch (err) {
        console.error("TRENDING_REELS_ERROR:", err);
        res.status(500).json({ message: 'Trending reels failed' });
    }
});

router.get('/curators/:id/reels', async (req, res) => {
    try {
        const curatorId = req.params.id;

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
        if (userId) {
            const favorites = await Favorite.find({
                userId,
                fileId: { $in: reels.map(r => r._id) }
            }).distinct('fileId');
            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }


        const formatted = reels.map((r) => {
            const category = r.category || 'other';
            const mediaUrl = r.path;

            return {
                id: r._id.toString(),
                mediaType: r.isVideo ? 'reel' : 'image',
                photo: {
                    id: r._id.toString(),
                    title: r.title || 'Untitled',
                    location: r.location || null,
                    date: r.uploadedAt,
                    category: category,
                    imageUrl: r.isVideo ? r.thumbnailUrl : r.path,
                    isFavorite: false,
                },
                videoUrl: r.isVideo ? r.path : null,
                user: {
                    id: r.createdBy._id.toString(),
                    name: r.createdBy.name || 'Curator',
                    avatarUrl: r.createdBy.avatarUrl || '',
                    wins: r.createdBy.wins || 0,
                },
                eventTitle: r.event || 'General',
                likes: r.likesCount || 0,
                comments: r.commentsCount || 0,
                isLiked: false,
                isBookmarked: bookmarkedSet.has(r._id.toString()), //  Add this

            };
        });

        res.json({ status: 'success', reels: formatted });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Failed to load reels' });
    }
});

router.get('/feed/infinite', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const limit = Math.min(parseInt(req.query.limit) || 10, 20);
        const source = req.query.source || 'explore';
        const eventFilter = req.query.eventFilter || 'all';

        const cursor = req.query.cursor
            ? JSON.parse(req.query.cursor)
            : null;

        const query = {
            archived: false,
            visibility: 'public',
        };

        // -----------------------
        // Cursor pagination (safe)
        // -----------------------
        if (cursor) {
            query.$and = [
                {
                    $or: [
                        { uploadedAt: { $lt: new Date(cursor.date) } },
                        {
                            uploadedAt: new Date(cursor.date),
                            _id: { $lt: cursor.id },
                        },
                    ],
                },
            ];
        }

        // -----------------------
        // Following filter
        // -----------------------
        let followingSet = new Set();
        if (source === 'following' && userId) {
            const ids = await Following.find({ follower: userId }).distinct(
                'following'
            );
            followingSet = new Set(ids.map((id) => id.toString()));
            query.createdBy = { $in: [...followingSet] };
        }

        // -----------------------
        // Event filter
        // -----------------------
        if (eventFilter !== 'all') {
            const now = new Date();
            let eventQuery = {};

            if (eventFilter === 'active') {
                eventQuery = {
                    startDate: { $lte: now },
                    endDate: { $gte: now },
                };
            } else if (eventFilter === 'upcoming') {
                eventQuery = { startDate: { $gt: now } };
            } else if (eventFilter === 'completed') {
                eventQuery = { endDate: { $lt: now } };
            } else if (eventFilter === 'myEvents' && userId) {
                eventQuery = { createdBy: userId };
            }

            const events = await Contest.find(eventQuery).select('_id');
            const eventIds = events.map((e) => e._id);

            query.$and = query.$and || [];
            query.$and.push({
                $or: [{ event: { $in: eventIds } }, { event: null }],
            });
        }

        // -----------------------
        // Fetch files
        // -----------------------
        const files = await FileMeta.find(query)
            .populate('createdBy', 'name avatarUrl wins')
            .populate('event', 'title startDate endDate')
            .sort({ uploadedAt: -1, _id: -1 })
            .limit(limit)
            .lean();

        // -----------------------
        // Likes
        // -----------------------
        let likedSet = new Set();
        if (userId && files.length) {
            const liked = await Like.find({
                user: userId,
                target: { $in: files.map((f) => f._id) },
            }).distinct('target');

            likedSet = new Set(liked.map((id) => id.toString()));
        }

        let bookmarkedSet = new Set();
        if (userId) {
            const favorites = await Favorite.find({
                userId,
                fileId: { $in: files.map(f => f._id) },
            }).distinct('fileId');

            bookmarkedSet = new Set(favorites.map(id => id.toString()));
        }


        // -----------------------
        // Build response
        // -----------------------
        const feed = files.map((f) => {
            const isVideo = f.mimeType?.startsWith('video/');
            let imageUrl = f.path;

            if (isVideo) {
                imageUrl = f.thumbnailUrl ||
                    cloudinary.url(f.cloudId, {
                        resource_type: 'video',
                        format: 'jpg',
                        transformation: [
                            { width: 400, crop: 'scale' },
                        ],
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
                isMyEvent: f.event?.createdBy?.toString() === userId,
                isFromFollowing: followingSet.has(
                    f.createdBy?._id?.toString()
                ),
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

        // -----------------------
        // Next cursor
        // -----------------------
        const last = files[files.length - 1];
        const nextCursor = last
            ? JSON.stringify({
                date: last.uploadedAt.toISOString(),
                id: last._id.toString(),
            })
            : null;

        res.json({
            status: 'success',
            reels: feed,
            nextCursor,
            hasMore: feed.length === limit,
        });
    } catch (err) {
        console.error('INFINITE_FEED_ERROR:', err);
        res.status(500).json({
            status: 'error',
            message: 'Feed failed',
        });
    }
});


module.exports = router;