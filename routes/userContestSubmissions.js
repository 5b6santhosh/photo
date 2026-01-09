// routes/contestSubmissions.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const razorpay = require('../services/razorpay');
const contestUpload = require('../middleware/contestUpload');
const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const Submission = require('../models/Submission');
const Payment = require('../models/Payment');
const { uploadToProvider, deleteFromProvider } = require('../services/storageService');

//  Use temp storage for cloud upload
const TEMP_UPLOAD_DIR = 'temp';
if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

const upload = multer({
    dest: TEMP_UPLOAD_DIR,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB hard limit
    fileFilter: (req, file, cb) => {
        // Basic filter — detailed validation happens in middleware
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

// Helper to build response (not needed for cloud — URL comes from service)
const buildFileResponse = (fileMeta) => {
    return {
        id: fileMeta._id,
        fileName: fileMeta.fileName,
        originalName: fileMeta.originalName,
        mimeType: fileMeta.mimeType,
        size: fileMeta.size,
        mediaUrl: fileMeta.path, //  This is the Cloudinary URL
        thumbnailUrl: fileMeta.mimeType.startsWith('image/')
            ? fileMeta.path
            : null // For video, you may want a separate thumbnail later
    };
};

// Submit to contest
router.post('/:id/submit', contestUpload, upload.single('media'), async (req, res) => {
    // Start a Session for Atomicity
    const session = await mongoose.startSession();
    session.startTransaction();
    let cloudFile;
    try {
        const { id: contestId } = req.params;
        const userId = req.user.id;
        const { caption, paymentId } = req.body;

        if (!req.file) {
            return res.status(400).json({
                message: 'Please select a photo or video to submit'
            });
        }


        //  VALIDATE CONTEST
        const contest = await Contest.findById(contestId).session(session);
        if (!contest) {
            return res.status(404).json({ message: 'Contest not found' });
        }
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({
                message: `Submissions are closed for "${contest.title}"`
            });
        }
        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        if (contest.entryFee > 0) {
            // PAID EVENT → REQUIRE payment verification
            if (!paymentId) {
                return res.status(400).json({
                    message: 'Payment required for this event'
                });
            }

            //  STEP 1: Find payment
            const payment = await Payment.findOne({
                paymentId,
                userId,
                contestId,
                status: 'verified',
                used: false
            }).session(session);

            if (!payment) {
                await session.abortTransaction();
                return res.status(400).json({ message: 'Invalid or unverified payment' });
            }

            //  STEP 2: Fetch Razorpay order to validate amount & currency
            let order;
            try {
                order = await razorpay.orders.fetch(payment.orderId);
            } catch (err) {
                console.error('Failed to fetch Razorpay order:', err.message);
                await session.abortTransaction();
                return res.status(500).json({ message: 'Payment validation failed' });
            }

            const expectedAmount = order.notes?.expectedAmount;
            const expectedCurrency = order.notes?.currency;

            // STEP 3: Validate integrity
            if (
                typeof expectedAmount !== 'number' ||
                !expectedCurrency ||
                payment.amount !== expectedAmount ||
                payment.currency !== expectedCurrency
            ) {
                // Optional: flag suspicious payment
                await Payment.findByIdAndUpdate(
                    payment._id,
                    { status: 'suspicious' },
                    { session }
                );
                await session.abortTransaction();
                return res.status(400).json({ message: 'Payment amount or currency mismatch' });
            }

            // STEP 4: Mark as used ONLY after validation
            await Payment.findByIdAndUpdate(
                payment._id,
                { used: true, usedAt: new Date() },
                { session }
            );

        }

        //  ENFORCE SUBMISSION LIMIT (ATOMIC)
        const userSubmissionCount = await Submission.countDocuments({
            contestId,
            userId,
        });
        if (userSubmissionCount >= contest.maxSubmissionsPerUser) {
            return res.status(400).json({
                message: `Max ${contest.maxSubmissionsPerUser} submission(s) allowed`
            });
        }

        const existingSubmission = await Submission.findOne({
            contestId,
            userId
        }).session(session);

        if (existingSubmission) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Already submitted to this contest' });
        }

        //  VALIDATE MEDIA TYPE
        const mediaType = getMediaType(req.file.mimetype);
        if (!contest.allowedMediaTypes.includes(mediaType)) {
            const allowed = contest.allowedMediaTypes.join(' or ');
            return res.status(400).json({
                message: `Only ${allowed} submissions are allowed for this contest`
            });
        }
        //  Upload to Cloud (Cloudinary, S3, etc.)
        cloudFile = await uploadToProvider(req.file);

        // Create FileMeta with cloud data
        const fileMeta = new FileMeta({
            fileName: cloudFile.publicId,        // Cloudinary public_id
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: cloudFile.url,                 // Full cloud URL (e.g., https://res.cloudinary.com/...)
            cloudId: cloudFile.publicId,         // For deletion/transformation
            thumbnailUrl: cloudFile.thumbnailUrl,
            createdBy: userId,
            description: caption,
            isSubmission: true,
            contestId
        });

        await fileMeta.save({ session });
        // Create Submission
        const submission = new Submission({
            userId,
            contestId,
            fileId: fileMeta._id,
            mediaType,
            caption,
            status: 'pending'
        });

        await submission.save({ session });
        await session.commitTransaction();
        session.endSession();

        const safeFileResponse = {
            id: fileMeta._id,
            mimeType: fileMeta.mimeType,
            mediaUrl: fileMeta.path,
            thumbnailUrl: fileMeta.thumbnailUrl
        };


        res.status(201).json({
            success: true,
            message: 'Submission successful',
            submission: {
                id: submission._id,
                contestId: submission.contestId,
                mediaType: submission.mediaType,
                caption: submission.caption,
                status: submission.status,
                submittedAt: submission.submittedAt,
                file: safeFileResponse
            }
        });

    } catch (error) {
        console.error('Submission error:', error);
        if (cloudFile?.publicId) {
            try {
                await deleteFromProvider(cloudFile.publicId);
            } catch (cleanupErr) {
                console.error('Cloud cleanup failed:', cleanupErr);
            }
        }
        await session.abortTransaction();
        return res.status(500).json({ message: 'Submission failed', error: error.message });
    } finally {
        session.endSession();
    }
});

// Get contest submissions
router.get('/:id/submissions', async (req, res) => {
    try {
        const contestId = req.params.id;
        const userId = req.user?.id || req.headers['x-user-id'];
        const { status } = req.query;

        const contest = await Contest.findById(contestId).populate('createdBy', 'username email');
        if (!contest) {
            return res.status(404).json({ message: 'Contest not found' });
        }

        let submissionsQuery = { contestId };
        if (status) submissionsQuery.status = status;

        const submissions = await Submission.find(submissionsQuery)
            .populate('userId', 'username email')
            .populate('fileId')
            .sort({ submittedAt: -1 });

        const submissionCount = submissions.length;

        let userSubmission = null;
        if (userId) {
            userSubmission = await Submission.findOne({ contestId, userId }).populate('fileId');
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
                maxFileSize: contest.maxFileSize
            },
            submissions: submissions.map(sub => ({
                ...sub.toObject(),
                file: sub.fileId ? buildFileResponse(sub.fileId) : null
            })),
            userHasSubmitted: !!userSubmission,
            userSubmission: userSubmission
                ? {
                    ...userSubmission.toObject(),
                    file: userSubmission.fileId ? buildFileResponse(userSubmission.fileId) : null
                }
                : null
        });

    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Get user's submission
router.get('/:id/my-submission', async (req, res) => {
    try {
        const contestId = req.params.id;
        const userId = req.user?.id || req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ message: 'User authentication required' });
        }

        const submission = await Submission.findOne({ contestId, userId })
            .populate('fileId')
            .populate('contestId', 'title description');

        if (!submission) {
            return res.status(404).json({ message: 'No submission found', hasSubmitted: false });
        }

        res.json({
            hasSubmitted: true,
            submission: {
                ...submission.toObject(),
                file: submission.fileId ? buildFileResponse(submission.fileId) : null
            }
        });

    } catch (error) {
        console.error('Get my submission error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Update caption
router.patch('/submissions/:submissionId', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { submissionId } = req.params;
        const userId = req.user.id;
        const { caption } = req.body;

        if (!caption?.trim()) {
            return res.status(400).json({ message: 'Caption cannot be empty' });
        }

        // Fetch submission with contest
        const submission = await Submission.findOne({ _id: submissionId, userId })
            .populate('fileId')
            .session(session);

        if (!submission) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Submission not found' });
        }

        const contest = await Contest.findById(submission.contestId).session(session);
        if (!contest?.isOpenForSubmissions) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Edits closed for this contest' });
        }

        // Update both records atomically
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
        res.json({ message: 'Caption updated successfully' });

    } catch (error) {
        await session.abortTransaction();
        console.error('Caption update error:', error);
        res.status(500).json({ message: 'Failed to update caption' });
    } finally {
        session.endSession();
    }
});

// Withdraw submission
router.delete('/submissions/:submissionId', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        const submission = await Submission.findOne({ _id: submissionId, userId })
            .populate('fileId')
            .session(session);

        if (!submission) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Submission not found' });
        }

        const contest = await Contest.findById(submission.contestId).session(session);
        if (!contest?.isOpenForSubmissions) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Withdrawals closed for this contest' });
        }

        // Delete from Cloudinary
        if (submission.fileId?.cloudId) {
            await deleteFromProvider(submission.fileId.cloudId);
        }

        // Delete both records
        await Promise.all([
            FileMeta.findByIdAndDelete(submission.fileId._id, { session }),
            submission.deleteOne({ session })
        ]);

        await session.commitTransaction();
        res.json({ success: true, message: 'Submission withdrawn' });

    } catch (error) {
        // Optional: attempt to re-upload if rollback needed (not typical for delete)
        await session.abortTransaction();
        console.error('Withdrawal error:', error);
        res.status(500).json({ message: 'Failed to withdraw submission' });
    } finally {
        session.endSession();
    }
});

module.exports = router;