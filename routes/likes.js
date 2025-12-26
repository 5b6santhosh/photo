const express = require('express');
const Like = require('../models/Like');

const router = express.Router();

/**
 * POST /api/likes/toggle
 */
router.post('/toggle', async (req, res) => {
    const { fileId, userId } = req.body;

    const existing = await Like.findOne({ fileId, userId });

    if (existing) {
        await existing.deleteOne();
        await FileMeta.findByIdAndUpdate(fileId, { $inc: { likesCount: -1 } });
        return res.json({ liked: false });
    }

    await Like.create({ fileId, userId });
    await FileMeta.findByIdAndUpdate(fileId, { $inc: { likesCount: 1 } });
    res.json({ liked: true });
});

module.exports = router;
