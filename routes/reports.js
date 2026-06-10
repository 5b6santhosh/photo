const express = require('express');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const FileMeta = require('../models/FileMeta');
const { authMiddleware: auth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/reports
 * Atomically submits a report. Safe against rapid taps and race conditions.
 */
router.post('/', auth, async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        const { fileId, reason } = req.body;

        if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ success: false, message: 'Invalid fileId' });
        }

        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid reason (min 3 chars)',
            });
        }

        const fileObjectId = new mongoose.Types.ObjectId(fileId);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Quick pre-check outside transaction to give fast feedback on duplicates
        const alreadyReported = await Report.exists({
            fileId: fileObjectId,
            reportedBy: userObjectId,
        });

        if (alreadyReported) {
            return res.status(400).json({
                success: false,
                message: 'You already reported this photo',
                reported: true,
            });
        }

        // Verify file exists and is reportable
        const file = await FileMeta.findById(fileObjectId)
            .select('createdBy visibility archived')
            .lean();

        if (!file || file.archived) {
            return res.status(404).json({ success: false, message: 'Photo not found' });
        }

        if (file.createdBy.toString() === userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot report your own content',
                reported: false,
            });
        }

        if (file.visibility === 'private' && file.createdBy.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Cannot report private content',
            });
        }

        // Atomically insert report + increment counter
        await session.withTransaction(async () => {
            // upsert — safe no-op if a concurrent request already inserted
            const result = await Report.updateOne(
                { fileId: fileObjectId, reportedBy: userObjectId },
                {
                    $setOnInsert: {
                        fileId: fileObjectId,
                        reportedBy: userObjectId,
                        reason: reason.trim(),
                        status: 'pending',
                    },
                },
                { upsert: true, session }
            );

            if (result.upsertedCount > 0) {
                await FileMeta.findByIdAndUpdate(
                    fileObjectId,
                    { $inc: { reportsCount: 1 } },
                    { session }
                );
            }
        });

        return res.json({
            success: true,
            message: 'Report submitted successfully',
            reported: true,
        });

    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'You already reported this photo',
                reported: true,
            });
        }
        console.error('REPORT_ERROR:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to submit report',
            reported: false,
        });
    } finally {
        session.endSession();
    }
});

/**
 * POST /api/reports/status-batch
 * Check report status for multiple files in one call.
 * Call this when loading a feed page so the flag icon reflects reality.
 */
router.post('/status-batch', auth, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { fileIds } = req.body;

        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ success: false, message: 'fileIds must be a non-empty array' });
        }

        const validIds = fileIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        const reports = await Report.find({
            fileId: { $in: validIds.map(id => new mongoose.Types.ObjectId(id)) },
            reportedBy: new mongoose.Types.ObjectId(userId),
        }).select('fileId').lean();

        const reportedSet = new Set(reports.map(r => r.fileId.toString()));

        const statusMap = {};
        validIds.forEach(id => {
            statusMap[id] = reportedSet.has(id);
        });

        return res.json({ success: true, data: statusMap });

    } catch (err) {
        console.error('REPORT_STATUS_BATCH_ERROR:', err);
        return res.status(500).json({ success: false, message: 'Failed to check report status' });
    }
});

/**
 * GET /api/reports/status/:fileId  — single file check (unchanged)
 */
router.get('/status/:fileId', auth, async (req, res) => {
    try {
        const { fileId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ success: false, message: 'Invalid fileId' });
        }
        const exists = await Report.exists({
            fileId: new mongoose.Types.ObjectId(fileId),
            reportedBy: new mongoose.Types.ObjectId(req.user.id),
        });
        return res.json({ success: true, reported: !!exists });
    } catch (err) {
        console.error('REPORT_STATUS_ERROR:', err);
        return res.status(500).json({ success: false, message: 'Failed to check report status' });
    }
});

/**
 * GET /api/reports/my  — unchanged
 */
router.get('/my', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const reports = await Report.find({ reportedBy: req.user.id })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate({ path: 'fileId', select: '_id path thumbnailPath title' });

        const formatted = reports.map(r => ({
            id: r._id.toString(),
            fileId: r.fileId?._id?.toString(),
            fileThumbnail: r.fileId?.thumbnailPath || r.fileId?.path,
            fileTitle: r.fileId?.title || 'Untitled',
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt,
        }));

        return res.json({
            success: true,
            data: formatted,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: await Report.countDocuments({ reportedBy: req.user.id }),
            },
        });
    } catch (err) {
        console.error('GET_MY_REPORTS_ERROR:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch reports' });
    }
});

module.exports = router;