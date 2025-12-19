const express = require('express');
const Report = require('../models/Report');

const router = express.Router();

/**
 * POST /api/reports
 */
router.post('/', async (req, res) => {
    const { fileId, userId, reason } = req.body;

    await Report.create({
        fileId,
        reportedBy: userId,
        reason,
    });

    res.json({ success: true, message: 'Report submitted' });
});

module.exports = router;
