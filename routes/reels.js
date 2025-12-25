const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');

/**
 * GET /api/reels/trending
 */
router.get('/trending', async (req, res) => {
    try {
        const now = new Date();

        const reels = await FileMeta.aggregate([
            {
                $match: {
                    archived: false,
                    isCurated: true,
                    visibility: 'public'
                }
            },
            {
                $addFields: {
                    freshnessScore: {
                        $divide: [
                            { $subtract: [now, '$uploadedAt'] },
                            -86400000 // days (negative so newer = higher)
                        ]
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
                $project: {
                    _id: 1,
                    fileName: 1,
                    likesCount: 1,
                    score: 1,
                    createdByName: 1
                }
            }
        ]);

        res.json(
            reels.map(r => ({
                id: r._id,
                imageUrl: `${process.env.BASE_URL}/uploads/${r.fileName}`,
                likes: r.likesCount,
                score: Math.round(r.score),
                userName: r.createdByName || 'Curator'
            }))
        );

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Trending reels failed' });
    }
});

module.exports = router;
