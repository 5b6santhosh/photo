const express = require('express');
const router = express.Router();
const Contest = require('../../models/Contest');
const ContestRules = require('../../models/ContestRules');
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
                allowedMediaTypes,
                bannerImage,
                maxSubmissionsPerUser,
                theme,
                keywords,
                entryFee

            } = req.body;

            if (!title || !startDate || !endDate) {
                return res.status(400).json({ message: 'Missing required fields' });
            }
            const creatorId = '600000000000000000000000';

            const contest = await Contest.create({
                title,
                subtitle,
                description,
                prizeText: prizeText || undefined,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                allowedMediaTypes: allowedMediaTypes || ['image'],
                bannerImage,
                maxSubmissionsPerUser: maxSubmissionsPerUser || 1,
                entryFee: entryFee || 0,
                createdBy: creatorId,
            });

            const rules = await ContestRules.create({
                contestId: contest._id,
                theme: theme || 'General',
                keywords: keywords || [],
                autoRejectNSFW: true,
                strictThemeMatch: false,
                allowPeople: true,
                requireVertical: false,
                minEntropy: 4.5,
                maxEntropy: 7.5,
                preferredColor: 'any',
                skinRange: [0, 40],
                allowImage: true,
                allowVideo: true,
                maxDurationSeconds: 60,
                autoApproveScore: 75,
                autoReviewScore: 50
            });

            contest.rules = rules._id;
            await contest.save();


            res.status(201).json({
                message: 'Event created successfully',
                eventId: contest._id,
                rulesId: rules._id

            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Event creation failed' });
        }
    }
);

module.exports = router;
