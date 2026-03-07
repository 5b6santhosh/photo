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

        // Validate inputs
        if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fileId'
            });
        }

        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid reason (min 3 chars)'
            });
        }

        // Verify file exists and is accessible
        const file = await FileMeta.findById(fileId).select('createdBy visibility archived');

        if (!file || file.archived) {
            return res.status(404).json({
                success: false,
                message: 'Photo not found'
            });
        }

        // Can't report private files unless you're the owner (but you can't report yourself)
        if (file.visibility === 'private' && file.createdBy.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Cannot report private content'
            });
        }

        // Prevent self-reporting
        if (file.createdBy.toString() === userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot report your own content',
                reported: false
            });
        }

        // Prevent duplicate reports
        const existingReport = await Report.findOne({ fileId, reportedBy: userId });

        if (existingReport) {
            return res.status(400).json({
                success: false,
                message: 'You already reported this photo',
                reported: true // Tell frontend it's already reported
            });
        }

        // Create report
        await Report.create({
            fileId,
            reportedBy: userId,
            reason: reason.trim(),
            status: 'pending'
        });

        // Increment reports count on file (for admin monitoring)
        await FileMeta.findByIdAndUpdate(fileId, {
            $inc: { reportsCount: 1 }
        });

        res.json({
            success: true,
            message: 'Report submitted successfully',
            reported: true
        });

    } catch (error) {
        console.error('REPORT_ERROR:', error);

        // Handle duplicate key errors (race condition)
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'You already reported this photo',
                reported: true
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to submit report',
            reported: false
        });
    }
});

/**
 * GET /api/reports/status/:fileId
 * Check if user has reported this file
 * @auth Required
 */
router.get('/status/:fileId', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fileId'
            });
        }

        const existingReport = await Report.findOne({ fileId, reportedBy: userId });

        res.json({
            success: true,
            reported: !!existingReport
        });

    } catch (error) {
        console.error('REPORT_STATUS_ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check report status'
        });
    }
});

/**
 * GET /api/reports/my
 * Get all reports submitted by current user
 * @auth Required
 */
router.get('/my', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const reports = await Report.find({ reportedBy: userId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate({
                path: 'fileId',
                select: '_id path thumbnailPath title'
            });

        const formatted = reports.map(r => ({
            id: r._id.toString(),
            fileId: r.fileId?._id?.toString(),
            fileThumbnail: r.fileId?.thumbnailPath || r.fileId?.path,
            fileTitle: r.fileId?.title || 'Untitled',
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt
        }));

        res.json({
            success: true,
            data: formatted,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: await Report.countDocuments({ reportedBy: userId })
            }
        });

    } catch (error) {
        console.error('GET_MY_REPORTS_ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reports'
        });
    }
});

module.exports = router;