const express = require('express');
const Save = require('../models/Save');

const router = express.Router();

router.post('/toggle', async (req, res) => {
    const { fileId, userId } = req.body;

    const existing = await Save.findOne({ fileId, userId });

    if (existing) {
        await existing.deleteOne();
        return res.json({ saved: false });
    }

    await Save.create({ fileId, userId });
    res.json({ saved: true });
});

module.exports = router;
