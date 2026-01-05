// routes/feed.js
const express = require('express');
const router = express.Router();
const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const User = require('../models/User');
const Following = require('../models/Following');

router.get('/', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;

        // Fetch files + populate user
        const files = await FileMeta.find({
            archived: false,
            visibility: 'public'
        })
            .populate('createdBy', 'name avatarUrl') //  Get user info safely
            .populate('event', 'title startDate endDate')
            .sort({ uploadedAt: -1 })
            .limit(100)
            .lean();

        const followingUserIds = userId
            ? await Following.find({ follower: userId }).distinct('following')
            : [];


        const feed = files.map(f => {
            const isVideo = f.mimeType.startsWith('video/');
            // 🔹 Event status
            const eventId = f.event?._id?.toString();
            let eventStatus = 'general';
            if (f.event) {
                const now = new Date();
                if (now < f.event.startDate) eventStatus = 'upcoming';
                else if (now > f.event.endDate) eventStatus = 'completed';
                else eventStatus = 'active';
            }

            // 🔹 Is from a user I follow?
            const isFromFollowing = followingUserIds.includes(f.createdBy?._id.toString());

            // 🔹 Is my own event?
            const isMyEvent = f.event?.createdBy?.toString() === userId;

            return {
                id: f._id.toString(),
                mediaType: isVideo ? 'reel' : 'image',
                photo: {
                    id: f._id.toString(),
                    title: f.title || 'Untitled',
                    imageUrl: isVideo ? f.thumbnailUrl : f.path,
                    category: f.category || 'other',
                }, videoUrl: isVideo ? f.path : null, //  Same URL works for Cloudinary video
                eventTitle: f.event?.title || 'General',
                eventStatus, //  'active', 'upcoming', 'completed', 'general'
                isMyEvent,   //  for "My Events" filter
                isFromFollowing, //  for "Following" tab
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