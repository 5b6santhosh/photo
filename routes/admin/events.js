const express = require('express');
const router = express.Router();
const Contest = require('../../models/Contest');
// const auth = require('../../middleware/auth');
// const adminOrMaster = require('../../middleware/adminOrMaster');

/**
 * POST /api/admin/events
 * Create curated contest
 */
router.post(
    '/',
    // auth,
    // adminOrMaster,
    async (req, res) => {
        try {
            const {
                title,
                subtitle,
                prizeText,
                startDate,
                endDate,
                allowedTypes // ['photo', 'reel']
            } = req.body;

            if (!title || !startDate || !endDate) {
                return res.status(400).json({ message: 'Missing required fields' });
            }
            const creatorId = '600000000000000000000000';

            const contest = await Contest.create({
                title,
                subtitle,
                prizeText,
                startDate,
                endDate,
                allowedTypes,
                // createdBy: req.user.id,
                createdBy: creatorId, // fallback dummy ObjectId
                status: 'upcoming',
                submissions: [],
                highlightPhotos: []
            });

            res.status(201).json({
                message: 'Event created successfully',
                eventId: contest._id
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Event creation failed' });
        }
    }
);

module.exports = router;
