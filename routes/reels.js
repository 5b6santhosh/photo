// routes/reels.js
const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');

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

        res.json(
            reels.map(r => ({
                id: r._id.toString(),
                imageUrl: r.path, //  Cloud video URL (works for thumbnails too)
                likes: r.likesCount,
                score: Math.round(r.score),
                userName: r.userName
            }))
        );
    } catch (err) {
        console.error("TRENDING_REELS_ERROR:", err);
        res.status(500).json({ message: 'Trending reels failed' });
    }
});

module.exports = router;