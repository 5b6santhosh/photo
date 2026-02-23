const express = require('express');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const FileMeta = require('../models/FileMeta');
const { authMiddleware: auth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/reports
 * Submit a report for a file
 * @body { fileId: string, reason: string }
 * @auth Required
 */
router.post('/', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId, reason } = req.body;

        //  Validate inputs
        if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ message: 'Invalid fileId' });
        }
        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ message: 'Please provide a valid reason (min 3 chars)' });
        }

        //  Verify file exists and get owner
        const file = await FileMeta.findById(fileId).select('createdBy');
        if (!file) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        //  Prevent self-reporting
        if (file.createdBy.toString() === userId) {
            return res.status(400).json({ message: 'You cannot report your own content' });
        }

        //  Prevent duplicate reports
        const existingReport = await Report.findOne({ fileId, reportedBy: userId });
        if (existingReport) {
            return res.status(400).json({ message: 'You already reported this photo' });
        }

        //  Create report
        await Report.create({
            fileId,
            reportedBy: userId,
            reason: reason.trim(),
        });

        res.json({
            success: true,
            message: 'Report submitted successfully',
            reported: true, // Helps frontend
        });

    } catch (error) {
        console.error('REPORT_ERROR:', error);

        // Handle duplicate key errors (just in case)
        if (error.code === 11000) {
            return res.status(400).json({ message: 'You already reported this photo' });
        }

        res.status(500).json({ message: 'Failed to submit report' });
    }
});

module.exports = router;