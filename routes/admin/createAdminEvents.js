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
                description,
                prizeText,
                startDate,
                endDate,
                allowedMediaTypes, // Matching Schema name
                bannerImage,
                maxSubmissionsPerUser } = req.body;

            if (!title || !startDate || !endDate) {
                return res.status(400).json({ message: 'Missing required fields' });
            }
            const creatorId = '600000000000000000000000';

            const contest = await Contest.create({
                title,
                subtitle,
                description,
                prizeText: prizeText || undefined, // Uses Schema default if empty
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                allowedMediaTypes: allowedMediaTypes || ['image'],
                bannerImage,
                maxSubmissionsPerUser: maxSubmissionsPerUser || 1,
                createdBy: creatorId,
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
