const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const FileMeta = require('../models/FileMeta');
const Like = require('../models/Like');
const Following = require('../models/Following');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

router.get('/feed', async (req, res) => {
    try {
        const userId = req.user?.id ?? null;
        const safeUserId = isValidObjectId(userId) ? userId : null;

        // ── 1. Fetch public files (no populate — we do a safe manual lookup) ──
        const files = await FileMeta.find({
            archived: false,
            visibility: 'public',
        })
            .sort({ uploadedAt: -1 })
            .limit(100)
            .lean();

        // ── 2. Safely resolve createdBy (only valid ObjectIds) ────────────────
        const creatorIdStrings = [...new Set(
            files
                .map(f => f.createdBy?.toString())
                .filter(id => isValidObjectId(id))
        )];

        const User = mongoose.model('User');
        const creators = creatorIdStrings.length
            ? await User.find(
                { _id: { $in: creatorIdStrings.map(id => new ObjectId(id)) } },
                'name avatarUrl'
            ).lean()
            : [];

        const creatorMap = creators.reduce((acc, u) => {
            acc[u._id.toString()] = u;
            return acc;
        }, {});

        // ── 3. Safely resolve event (only valid ObjectIds) ────────────────────
        const eventIdStrings = [...new Set(
            files
                .map(f => f.event?.toString())
                .filter(id => isValidObjectId(id))
        )];

        const Contest = require('../models/Contest');
        const events = eventIdStrings.length
            ? await Contest.find(
                { _id: { $in: eventIdStrings.map(id => new ObjectId(id)) } },
                'title startDate endDate createdBy contestStatus'
            ).lean()
            : [];

        const eventMap = events.reduce((acc, e) => {
            acc[e._id.toString()] = e;
            return acc;
        }, {});

        // ── 4. Who does this user follow? ─────────────────────────────────────
        const followingUserIds = safeUserId
            ? (await Following.find({ follower: safeUserId }).distinct('following'))
                .map(id => id.toString())
            : [];

        // ── 5. Aggregate like counts ──────────────────────────────────────────
        const validFileObjectIds = files
            .filter(f => isValidObjectId(f._id?.toString()))
            .map(f => new ObjectId(f._id.toString()));

        let likeCounts = {};
        if (validFileObjectIds.length > 0) {
            const aggregationResult = await Like.aggregate([
                { $match: { fileId: { $in: validFileObjectIds } } },
                { $group: { _id: '$fileId', count: { $sum: 1 } } }
            ]);
            likeCounts = aggregationResult.reduce((acc, curr) => ({
                ...acc,
                [curr._id.toString()]: curr.count
            }), {});
        }

        // ── 6. Build feed items ───────────────────────────────────────────────
        const feed = files.map(f => {
            if (!f._id) return null;

            const fileId = f._id.toString();
            const isVideo = f.mimeType?.startsWith('video/') ?? false;

            const createdByIdStr = f.createdBy?.toString();
            const creator = isValidObjectId(createdByIdStr)
                ? (creatorMap[createdByIdStr] ?? null)
                : null;
            const createdById = creator?._id?.toString() ?? null;

            const eventIdStr = f.event?.toString();
            const event = isValidObjectId(eventIdStr)
                ? (eventMap[eventIdStr] ?? null)
                : null;

            let eventStatus = 'general';
            if (event) {
                const now = new Date();
                const start = event.startDate ? new Date(event.startDate) : null;
                const end = event.endDate ? new Date(event.endDate) : null;
                if (start && end && !isNaN(start) && !isNaN(end)) {
                    if (now < start) eventStatus = 'upcoming';
                    else if (now > end) eventStatus = 'completed';
                    else eventStatus = 'active';
                }
            }

            const isMyEvent = !!(safeUserId && event?.createdBy?.toString() === safeUserId.toString());
            const isFromFollowing = !!(createdById && followingUserIds.includes(createdById));

            return {
                id: fileId,
                mediaType: isVideo ? 'reel' : 'image',
                photo: {
                    id: fileId,
                    title: f.title || 'Untitled',
                    imageUrl: isVideo ? (f.thumbnailUrl || null) : (f.path || null),
                    category: f.category || 'other',
                },
                videoUrl: isVideo ? (f.path || null) : null,
                eventTitle: event?.title || 'General',
                eventStatus,
                isMyEvent,
                isFromFollowing,
                isSubmission: f.isSubmission || false,
                likes: likeCounts[fileId] || 0,
                comments: f.commentsCount || 0,
                isLiked: false,
                user: {
                    id: createdById || null,
                    name: creator?.name || 'Anonymous',
                    avatarUrl: creator?.avatarUrl || ''
                }
            };
        }).filter(Boolean);

        // ── 7. Populate isLiked ───────────────────────────────────────────────
        // if (safeUserId) {
        //     const likedFileIds = (await Like.find({ userId: safeUserId }).distinct('fileId'))
        //         .map(id => id.toString());
        //     feed.forEach(item => {
        //         item.isLiked = likedFileIds.includes(item.id);
        //     });
        // }
        // ── 7. Populate isLiked ───────────────────────────────────────────────
        if (safeUserId) {
            const likedFileIds = (await Like.find({
                userId: new ObjectId(safeUserId) 
            }).distinct('fileId'))
                .map(id => id.toString());
            feed.forEach(item => {
                item.isLiked = likedFileIds.includes(item.id);
            });
        }

        return res.status(200).json({ status: 'success', count: feed.length, feed });

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