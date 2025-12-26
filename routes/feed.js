// // GET /api/feed
// router.get('/feed', async (req, res) => {
//     try {
//         const files = await FileMeta.find({
//             archived: false,
//             visibility: 'public',
//         })
//             .sort({ uploadedAt: -1 })
//             .limit(50)
//             .lean();

//         const feed = files.map((f) => ({
//             id: f._id.toString(),
//             mediaType: f.isVideo ? 'reel' : 'image',
//             imageUrl: f.isVideo ? f.thumbnailUrl : `${process.env.BASE_URL}/uploads/${f.fileName}`,
//             videoUrl: f.isVideo ? `${process.env.BASE_URL}/videos/${f.videoFile}` : null,
//             eventTitle: f.eventTitle,
//             likes: f.likesCount || 0,
//             comments: f.commentsCount || 0,
//             isLiked: false, // fill later using userId
//             user: {
//                 id: f.createdBy,
//                 name: f.createdByName,
//                 avatarUrl: f.createdByAvatar,
//             },
//         }));

//         res.json({ feed });
//     } catch (e) {
//         res.status(500).json({ message: 'Feed error' });
//     }
// });

const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');

// GET /api/feed
router.get('/', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;

        const files = await FileMeta.find({
            archived: false,
            visibility: 'public',
        })
            .sort({ uploadedAt: -1 })
            .limit(50)
            .lean();

        const feed = await Promise.all(files.map(async (f) => {
            let isLiked = false;

            if (userId) {
                isLiked = !!(await Like.exists({ fileId: f._id, userId: userId }));
            }

            return {
                id: f._id.toString(),
                mediaType: f.isVideo ? 'reel' : 'image',
                imageUrl: f.isVideo
                    ? f.thumbnailUrl
                    : `${process.env.BASE_URL}/uploads/${f.fileName}`,
                videoUrl: f.isVideo
                    ? `${process.env.BASE_URL}/videos/${f.videoFile}`
                    : null,
                eventTitle: f.eventTitle || "General",
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: isLiked,
                user: {
                    id: f.createdBy,
                    name: f.createdByName || "Anonymous",
                    avatarUrl: f.createdByAvatar || "",
                },
            };
        }));

        res.status(200).json({
            status: "success",
            count: feed.length,
            feed: feed
        });
    } catch (e) {
        console.error("FEED_API_ERROR:", e);
        res.status(500).json({ status: "error", message: 'Feed error' });
    }
});

module.exports = router;