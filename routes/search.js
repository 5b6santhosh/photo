//GET /api/search?q=street

const express = require('express');
const router = express.Router();

const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const User = require('../models/User');

router.get('/', async (req, res) => {
    try {
        const q = req.query.q?.trim() || '';
        if (!q) {
            return res.json({ events: [], reels: [], curators: [] });
        }

        const regex = new RegExp(q, 'i');

        const events = await Contest.find({
            title: regex,
            visibility: 'public',
        }).limit(10).lean();

        const reels = await FileMeta.find({
            archived: false,
            isCurated: true,
            $or: [
                { description: regex }, // caption
                { originalName: regex }
            ]
        }).limit(12).lean();

        const curators = await User.find({
            name: regex,
        }).select('name avatarUrl wins').limit(10).lean();

        res.json({ events, reels, curators });
    } catch (e) {
        res.status(500).json({ message: 'Search failed' });
    }
});

module.exports = router;
