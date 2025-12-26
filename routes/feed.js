// routes/feed.js
const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const User = require('../models/User');

router.get('/', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;

        // Fetch files + populate user
        const files = await FileMeta.find({
            archived: false,
            visibility: 'public'
        })
            .populate('createdBy', 'name avatarUrl') //  Get user info safely
            .sort({ uploadedAt: -1 })
            .limit(50)
            .lean();

        const feed = files.map(f => {
            const isVideo = f.mimeType.startsWith('video/');
            return {
                id: f._id.toString(),
                mediaType: isVideo ? 'reel' : 'image',
                imageUrl: isVideo ? null : f.path, //  Use cloud URL
                videoUrl: isVideo ? f.path : null, //  Same URL works for Cloudinary video
                eventTitle: "General", // or link to Event model if you have one
                likes: f.likesCount || 0,
                comments: f.commentsCount || 0,
                isLiked: false, // We'll set this below if userId exists
                user: {
                    id: f.createdBy?._id?.toString() || null,
                    name: f.createdBy?.name || "Anonymous",
                    avatarUrl: f.createdBy?.avatarUrl || ""
                }
            };
        });

        // Only check likes if user is logged in
        if (userId) {
            const likedFileIds = await Like.find({ userId })
                .distinct('fileId')
                .then(ids => ids.map(id => id.toString()));

            feed.forEach(item => {
                item.isLiked = likedFileIds.includes(item.id);
            });
        }

        res.status(200).json({
            status: "success",
            count: feed.length,
            feed
        });
    } catch (e) {
        console.error("FEED_API_ERROR:", e);
        res.status(500).json({ status: "error", message: 'Feed error' });
    }
});

module.exports = router;