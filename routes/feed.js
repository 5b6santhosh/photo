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

        const files = await FileMeta.find({
            archived: false,
            visibility: 'public'
        })
            .populate('createdBy', 'name avatarUrl')
            .populate('event', 'title startDate endDate createdBy') //  Added createdBy
            .sort({ uploadedAt: -1 })
            .limit(100)
            .lean();

        const followingUserIds = userId
            ? await Following.find({ follower: userId }).distinct('following')
            : [];

        //  Get actual like counts
        const fileIds = files.map(f => f._id.toString());
        const likeCounts = await Like.aggregate([
            { $match: { fileId: { $in: fileIds.map(id => new ObjectId(id)) } } },
            { $group: { _id: "$fileId", count: { $sum: 1 } } }
        ]).then(results =>
            results.reduce((acc, curr) => ({ ...acc, [curr._id.toString()]: curr.count }), {})
        );

        const feed = files.map(f => {
            const isVideo = f.mimeType?.startsWith('video/');
            const fileId = f._id.toString();

            // Event status logic
            let eventStatus = 'general';
            if (f.event) {
                const now = new Date();
                if (now < f.event.startDate) eventStatus = 'upcoming';
                else if (now > f.event.endDate) eventStatus = 'completed';
                else eventStatus = 'active';
            }

            const isFromFollowing = followingUserIds.includes(f.createdBy?._id?.toString());

            //  Now works because we populated event.createdBy
            const isMyEvent = f.event?.createdBy?.toString() === userId;

            return {
                id: fileId,
                mediaType: isVideo ? 'reel' : 'image',
                photo: {
                    id: fileId,
                    title: f.title || 'Untitled',
                    imageUrl: isVideo ? f.thumbnailUrl : f.path,
                    category: f.category || 'other',
                },
                videoUrl: isVideo ? f.path : null,
                eventTitle: f.event?.title || 'General',
                eventStatus,      // 'active', 'upcoming', 'completed', 'general'
                isMyEvent,        //  Now works
                isFromFollowing,  // for "Following" tab
                likes: likeCounts[fileId] || 0,  // Actual count
                comments: f.commentsCount || 0,  // Or populate similarly
                isLiked: false,   // Set below if userId exists
                user: {
                    id: f.createdBy?._id?.toString() || null,
                    name: f.createdBy?.name || "Anonymous",
                    avatarUrl: f.createdBy?.avatarUrl || ""
                }
            };
        });

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