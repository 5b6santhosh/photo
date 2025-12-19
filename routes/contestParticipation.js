const express = require('express');
const ContestEntry = require('../models/ContestEntry');
const Contest = require('../models/Contest');
// const { verifyToken } = require('../utils/jwt');


const router = express.Router();

/**
 * POST /api/contest/participate
 */
router.post('/participate',
    //  verifyToken, 
    async (req, res) => {
        try {
            const { contestId, userId, fileId } = req.body;

            const contest = await Contest.findById(contestId);
            if (!contest || !contest.isActive) {
                return res.status(400).json({ message: 'Contest not active' });
            }

            const alreadySubmitted = await ContestEntry.findOne({
                contestId,
                userId,
                fileId,
            });

            if (alreadySubmitted) {
                return res.status(409).json({ message: 'Already submitted' });
            }

            const entry = await ContestEntry.create({
                contestId,
                userId,
                fileId,
            });

            res.json({
                success: true,
                message: 'Participation successful',
                entry,
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

module.exports = router;
