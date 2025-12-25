const express = require('express');
const ContestEntry = require('../models/ContestEntry');

const router = express.Router();

/**
 * ADMIN: Declare winners
 */
router.post('/declare', async (req, res) => {
    const { contestId, winners } = req.body;
    // winners = [{ entryId, position }]

    for (const w of winners) {
        await ContestEntry.findByIdAndUpdate(w.entryId, {
            status: w.position, // winner / shortlisted
        });
    }

    res.json({ success: true });
});

/**
 * USER: Get my result
 */
router.get('/my/:contestId', async (req, res) => {
    const { contestId } = req.params;
    const userId = req.user.id;

    const entry = await ContestEntry.findOne({ contestId, userId })
        .populate('fileId');

    res.json(entry);
});

module.exports = router;
