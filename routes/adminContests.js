//Admin posts official challenges

const express = require('express');
const Contest = require('../models/Contest');

const router = express.Router();

/**
 * POST /api/admin/contest
 * (Later protect with admin auth)
 */
router.post('/', async (req, res) => {
    const {
        title,
        description,
        bannerImage,
        startDate,
        endDate,
    } = req.body;

    const contest = await Contest.create({
        title,
        description,
        bannerImage,
        startDate,
        endDate,
        isActive: true,
    });

    res.json({ success: true, contest });
});

/**
 * PATCH /api/admin/contest/:id/close
 */
router.patch('/:id/close', async (req, res) => {
    await Contest.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true });
});

module.exports = router;
