// routes/contestSubmissions.js - FIXED VERSION
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth'); // FIXED: Added auth import
const contestUpload = require('../middleware/contestUpload');
const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const Submission = require('../models/Submission');
const ContestEntry = require('../models/ContestEntry');
const Payment = require('../models/Payment');
const { uploadToProvider, deleteFromProvider } = require('../services/storageService');

// Use temp storage for cloud upload
const TEMP_UPLOAD_DIR = 'temp';
if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

const upload = multer({
    dest: TEMP_UPLOAD_DIR,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB hard limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/mpeg', 'video/ogg', 'video/webm', 'video/quicktime'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type'));
        }
    }
});

const getMediaType = (mimeType) => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'unknown';
};

const buildFileResponse = (fileMeta) => {
    return {
        id: fileMeta._id,
        fileName: fileMeta.fileName,
        originalName: fileMeta.originalName,
        mimeType: fileMeta.mimeType,
        size: fileMeta.size,
        mediaUrl: fileMeta.path,
        thumbnailUrl: fileMeta.mimeType.startsWith('image/')
            ? fileMeta.path
            : fileMeta.thumbnailUrl || null
    };
};

/**
 * POST /:id/submit
 * Submit media to contest (with payment verification for paid contests)
 */
router.post('/:id/submit', auth, contestUpload, upload.single('media'), async (req, res) => {
    let session;
    let cloudFile;
    let tempFilePath = req.file?.path;

    try {
        const { id: contestId } = req.params;
        const userId = req.user.id;
        const { caption } = req.body;

        // ─────────────────────────────────────────────
        // VALIDATION
        // ─────────────────────────────────────────────
        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            if (tempFilePath) fs.unlinkSync(tempFilePath);
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        if (!req.file) {
            return res.status(400).json({
                message: 'Please select a photo or video to submit'
            });
        }

        // Start transaction
        session = await mongoose.startSession();
        session.startTransaction();

        // ─────────────────────────────────────────────
        // VALIDATE CONTEST
        // ─────────────────────────────────────────────
        const contest = await Contest.findById(contestId).session(session);
        if (!contest) {
            throw new Error('Contest not found');
        }

        if (!contest.isOpenForSubmissions) {
            throw new Error(`Submissions are closed for "${contest.title}"`);
        }

        // ─────────────────────────────────────────────
        // CHECK FOR EXISTING SUBMISSION (Race condition protection)
        // ─────────────────────────────────────────────
        const existingSubmission = await Submission.findOne({
            contestId,
            userId
        }).session(session);

        if (existingSubmission) {
            throw new Error('You have already submitted to this contest');
        }

        // ─────────────────────────────────────────────
        // PAID CONTEST: Verify Payment & ContestEntry
        // ─────────────────────────────────────────────
        let contestEntry = null;

        if (contest.entryFee > 0) {
            // Check for verified payment
            const verifiedPayment = await Payment.findOne({
                userId,
                contestId,
                status: 'verified'
            }).session(session);

            if (!verifiedPayment) {
                throw new Error('No verified payment found. Please complete payment first.');
            }

            // Get contest entry (should exist from webhook)
            contestEntry = await ContestEntry.findOne({
                contestId,
                userId,
                status: 'paid'
            }).session(session);

            if (!contestEntry) {
                throw new Error('No valid contest entry found. Please contact support.');
            }

            // Check if already submitted via contestEntry status
            if (contestEntry.status === 'submitted') {
                throw new Error('You have already submitted to this contest');
            }
        }

        // ─────────────────────────────────────────────
        // ENFORCE SUBMISSION LIMIT
        // ─────────────────────────────────────────────
        const userSubmissionCount = await Submission.countDocuments({
            contestId,
            userId
        }).session(session);

        if (userSubmissionCount >= contest.maxSubmissionsPerUser) {
            throw new Error(`Maximum ${contest.maxSubmissionsPerUser} submission(s) allowed per user`);
        }

        // ─────────────────────────────────────────────
        // VALIDATE MEDIA TYPE
        // ─────────────────────────────────────────────
        const mediaType = getMediaType(req.file.mimetype);
        if (!contest.allowedMediaTypes.includes(mediaType)) {
            const allowed = contest.allowedMediaTypes.join(' or ');
            throw new Error(`Only ${allowed} submissions are allowed for this contest`);
        }

        // ─────────────────────────────────────────────
        // UPLOAD TO CLOUD STORAGE
        // ─────────────────────────────────────────────
        cloudFile = await uploadToProvider(req.file);

        const fileMeta = new FileMeta({
            fileName: cloudFile.publicId,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: cloudFile.url,
            cloudId: cloudFile.publicId,
            thumbnailUrl: cloudFile.thumbnailUrl,
            createdBy: userId,
            description: caption || '',
            isSubmission: true,
            contestId
        });

        await fileMeta.save({ session });

        // ─────────────────────────────────────────────
        // CREATE SUBMISSION
        // ─────────────────────────────────────────────
        const submission = new Submission({
            userId,
            contestId,
            contestEntryId: contestEntry?._id || null, // FIXED: Handle free contests
            fileId: fileMeta._id,
            mediaType,
            caption: caption || '',
            status: 'pending'
        });

        await submission.save({ session });

        // ─────────────────────────────────────────────
        // UPDATE CONTEST ENTRY (only for paid contests)
        // ─────────────────────────────────────────────
        // FIXED: Single update, not double
        if (contestEntry) {
            await ContestEntry.findByIdAndUpdate(
                contestEntry._id,
                {
                    status: 'submitted',
                    submittedAt: new Date()
                },
                { session }
            );
        }

        // ─────────────────────────────────────────────
        // UPDATE CONTEST STATS
        // ─────────────────────────────────────────────
        await Contest.findByIdAndUpdate(
            contestId,
            {
                $inc: { submissionCount: 1 }
            },
            { session }
        );

        // Commit transaction
        await session.commitTransaction();

        // Clean up temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        res.status(201).json({
            success: true,
            message: 'Submission successful',
            submission: {
                id: submission._id,
                contestId: submission.contestId,
                mediaType: submission.mediaType,
                caption: submission.caption,
                status: submission.status,
                submittedAt: submission.createdAt,
                file: {
                    id: fileMeta._id,
                    mimeType: fileMeta.mimeType,
                    mediaUrl: fileMeta.path,
                    thumbnailUrl: fileMeta.thumbnailUrl
                }
            }
        });

    } catch (error) {
        console.error('Submission error:', error);

        // Rollback transaction
        if (session) {
            await session.abortTransaction();
        }

        // Clean up uploaded cloud file
        if (cloudFile?.publicId) {
            try {
                await deleteFromProvider(cloudFile.publicId);
                console.log('Cloud file cleanup successful');
            } catch (cleanupErr) {
                console.error('Cloud cleanup failed:', cleanupErr);
            }
        }

        // Clean up temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        return res.status(400).json({
            message: error.message || 'Submission failed'
        });

    } finally {
        if (session) {
            session.endSession();
        }
    }
});

/**
 * GET /:id/submissions
 * Get all submissions for a contest
 */
router.get('/:id/submissions', async (req, res) => {
    try {
        const contestId = req.params.id;
        const userId = req.user?.id;
        const { status } = req.query;

        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contest = await Contest.findById(contestId)
            .populate('createdBy', 'username email')
            .select('-__v');

        if (!contest) {
            return res.status(404).json({ message: 'Contest not found' });
        }

        let submissionsQuery = { contestId };
        if (status) submissionsQuery.status = status;

        const submissions = await Submission.find(submissionsQuery)
            .populate('userId', 'username email')
            .populate('fileId')
            .sort({ createdAt: -1 });

        const submissionCount = submissions.length;

        let userSubmission = null;
        let userHasSubmitted = false;

        if (userId) {
            userSubmission = await Submission.findOne({ contestId, userId })
                .populate('fileId');
            userHasSubmitted = !!userSubmission;
        }

        res.json({
            contest: {
                id: contest._id,
                title: contest.title,
                description: contest.description,
                startDate: contest.startDate,
                endDate: contest.endDate,
                isActiveNow: contest.isActiveNow,
                isOpenForSubmissions: contest.isOpenForSubmissions,
                submissionCount,
                maxSubmissionsPerUser: contest.maxSubmissionsPerUser,
                allowedMediaTypes: contest.allowedMediaTypes,
                maxFileSize: contest.maxFileSize,
                entryFee: contest.entryFee
            },
            submissions: submissions.map(sub => ({
                id: sub._id,
                userId: sub.userId,
                contestId: sub.contestId,
                mediaType: sub.mediaType,
                caption: sub.caption,
                status: sub.status,
                submittedAt: sub.createdAt,
                file: sub.fileId ? buildFileResponse(sub.fileId) : null
            })),
            userHasSubmitted,
            userSubmission: userSubmission ? {
                id: userSubmission._id,
                contestId: userSubmission.contestId,
                mediaType: userSubmission.mediaType,
                caption: userSubmission.caption,
                status: userSubmission.status,
                submittedAt: userSubmission.createdAt,
                file: userSubmission.fileId ? buildFileResponse(userSubmission.fileId) : null
            } : null
        });

    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

/**
 * GET /:id/my-submission
 * Get current user's submission for a contest
 */
router.get('/:id/my-submission', auth, async (req, res) => {
    try {
        const contestId = req.params.id;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const submission = await Submission.findOne({ contestId, userId })
            .populate('fileId')
            .populate('contestId', 'title description entryFee');

        if (!submission) {
            return res.status(404).json({
                message: 'No submission found',
                hasSubmitted: false
            });
        }

        res.json({
            hasSubmitted: true,
            submission: {
                id: submission._id,
                contestId: submission.contestId,
                mediaType: submission.mediaType,
                caption: submission.caption,
                status: submission.status,
                submittedAt: submission.createdAt,
                file: submission.fileId ? buildFileResponse(submission.fileId) : null
            }
        });

    } catch (error) {
        console.error('Get my submission error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

/**
 * PATCH /submissions/:submissionId
 * Update submission caption
 */
router.patch('/submissions/:submissionId', auth, async (req, res) => { // FIXED: Added auth
    let session;

    try {
        const { submissionId } = req.params;
        const userId = req.user.id;
        const { caption } = req.body;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({ message: 'Invalid submission ID' });
        }

        if (!caption?.trim()) {
            return res.status(400).json({ message: 'Caption cannot be empty' });
        }

        session = await mongoose.startSession();
        session.startTransaction();

        // Fetch submission with ownership check
        const submission = await Submission.findOne({ _id: submissionId, userId })
            .populate('fileId')
            .session(session);

        if (!submission) {
            throw new Error('Submission not found or you do not have permission');
        }

        // Check if contest still allows edits
        const contest = await Contest.findById(submission.contestId).session(session);
        if (!contest?.isOpenForSubmissions) {
            throw new Error('Edits are closed for this contest');
        }

        // Update both FileMeta and Submission atomically
        await Promise.all([
            FileMeta.findByIdAndUpdate(
                submission.fileId,
                { description: caption.trim() },
                { session }
            ),
            Submission.findByIdAndUpdate(
                submissionId,
                { caption: caption.trim() },
                { session }
            )
        ]);

        await session.commitTransaction();

        res.json({
            success: true,
            message: 'Caption updated successfully'
        });

    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        console.error('Caption update error:', error);
        res.status(400).json({
            message: error.message || 'Failed to update caption'
        });
    } finally {
        if (session) {
            session.endSession();
        }
    }
});

/**
 * DELETE /submissions/:submissionId
 * Withdraw submission (deletes file and submission record)
 */
router.delete('/submissions/:submissionId', auth, async (req, res) => { // FIXED: Added auth
    let session;

    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({ message: 'Invalid submission ID' });
        }

        session = await mongoose.startSession();
        session.startTransaction();

        const submission = await Submission.findOne({ _id: submissionId, userId })
            .populate('fileId')
            .session(session);

        if (!submission) {
            throw new Error('Submission not found or you do not have permission');
        }

        const contest = await Contest.findById(submission.contestId).session(session);
        if (!contest?.isOpenForSubmissions) {
            throw new Error('Withdrawals are closed for this contest');
        }

        // Delete from cloud storage
        if (submission.fileId?.cloudId) {
            await deleteFromProvider(submission.fileId.cloudId);
        }

        // Revert ContestEntry status (if paid contest)
        if (submission.contestEntryId) {
            await ContestEntry.findByIdAndUpdate(
                submission.contestEntryId,
                {
                    status: 'paid',
                    submittedAt: null
                },
                { session }
            );
        }

        // Delete database records
        await Promise.all([
            FileMeta.findByIdAndDelete(submission.fileId._id, { session }),
            Submission.findByIdAndDelete(submissionId, { session })
        ]);

        // Update contest stats
        await Contest.findByIdAndUpdate(
            contest._id,
            {
                $inc: { submissionCount: -1 }
            },
            { session }
        );

        await session.commitTransaction();

        res.json({
            success: true,
            message: 'Submission withdrawn successfully'
        });

    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        console.error('Withdrawal error:', error);
        res.status(400).json({
            message: error.message || 'Failed to withdraw submission'
        });
    } finally {
        if (session) {
            session.endSession();
        }
    }
});

module.exports = router;