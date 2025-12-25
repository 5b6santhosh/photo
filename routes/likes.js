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
        return res.json({ liked: false });
    }

    await Like.create({ fileId, userId });
    res.json({ liked: true });
});

module.exports = router;
