// //GET /api/search?q=street

const express = require('express');
const router = express.Router();

const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const User = require('../models/User');

router.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const regex = q ? new RegExp(q, 'i') : null;

        /* =========================
           🔥 TRENDING EVENTS
        ========================= */
        const events = await Contest.find({
            visibility: 'public',
            ...(regex ? { title: regex } : {}),
        })
            .sort({ totalSubmissions: -1, createdAt: -1 })
            .limit(8)
            .lean();

        /* =========================
           🎬 CURATED REELS
        ========================= */
        const reels = await FileMeta.find({
            archived: false,
            visibility: 'public',
            isCurated: true,
            ...(regex
                ? {
                    $or: [
                        { title: regex },
                        { description: regex },
                        { originalName: regex },
                    ],
                }
                : {}),
        })
            .sort({ likesCount: -1, uploadedAt: -1 })
            .limit(12)
            .lean();

        const formattedReels = reels.map((r) => ({
            id: r._id,
            mediaType: r.isVideo ? 'reel' : 'image',
            imageUrl: r.isVideo ? r.thumbnailUrl : `${process.env.BASE_URL}/uploads/${r.fileName}`,
            videoUrl: r.isVideo ? `${process.env.BASE_URL}/videos/${r.videoFile}` : null,
            likes: r.likesCount,
            comments: r.commentsCount,
            eventTitle: r.title || 'General',
        }));

        /* =========================
           🧑‍🎨 TOP CURATORS
        ========================= */
        const curators = await User.find(
            regex ? { username: regex } : {}
        )
            .select('username avatarUrl wins')
            .sort({ wins: -1 })
            .limit(10)
            .lean();

        res.json({
            status: 'success',
            events,
            reels: formattedReels,
            curators: curators.map((u) => ({
                id: u._id,
                name: u.username,
                avatarUrl: u.avatarUrl,
                wins: u.wins,
            })),
        });
    } catch (err) {
        console.error('EXPLORE_SEARCH_ERROR', err);
        res.status(500).json({ status: 'error', message: 'Explore search failed' });
    }
});


router.get('/filter', async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const userId = req.user?.id;
        const now = new Date();

        let contestQuery = { visibility: 'public' };

        if (filter === 'active') {
            contestQuery.startDate = { $lte: now };
            contestQuery.endDate = { $gte: now };
        } else if (filter === 'upcoming') {
            contestQuery.startDate = { $gt: now };
        } else if (filter === 'completed') {
            contestQuery.endDate = { $lt: now };
        }

        let contestIds = [];

        if (filter !== 'all' && filter !== 'myEvents') {
            const contests = await Contest.find(contestQuery)
                .select('_id')
                .lean();
            contestIds = contests.map(c => c._id);
        }

        const fileQuery = {
            archived: false,
            visibility: 'public',
        };

        if (filter === 'myEvents') {
            fileQuery.createdBy = userId;
        }

        if (contestIds.length) {
            fileQuery.contestId = { $in: contestIds };
        }

        const files = await FileMeta.find(fileQuery)
            .sort({ uploadedAt: -1 })
            .limit(50)
            .lean();

        const feed = files.map(f => ({
            id: f._id,
            mediaType: f.isVideo ? 'reel' : 'image',
            imageUrl: f.isVideo
                ? f.thumbnailUrl
                : `${process.env.BASE_URL}/uploads/${f.fileName}`,
            videoUrl: f.isVideo
                ? `${process.env.BASE_URL}/videos/${f.videoFile}`
                : null,
            likes: f.likesCount,
            comments: f.commentsCount,
            eventTitle: f.title || 'General',
        }));

        res.json({ status: 'success', feed });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Feed failed' });
    }
});



module.exports = router;
