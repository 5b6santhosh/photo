// // routes/contestSubmissions.js
// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const contestUpload = require('../middleware/contestUpload');

// const Contest = require('../models/Contest');
// const FileMeta = require('../models/FileMeta');
// const Submission = require('../models/Submission');
// const { uploadToProvider, deleteFromProvider } = require('../services/storageService');


// const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads/contest-submissions';

// if (!fs.existsSync(UPLOAD_DIR)) {
//     fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// }

// const checkMediaType = (mimeType, allowedTypes) => {
//     const isImage = mimeType.startsWith('image/');
//     const isVideo = mimeType.startsWith('video/');
//     return (
//         (allowedTypes.includes('image') && isImage) ||
//         (allowedTypes.includes('video') && isVideo)
//     );
// };

// const getMediaType = (mimeType) => {
//     if (mimeType.startsWith('image/')) return 'image';
//     if (mimeType.startsWith('video/')) return 'video';
//     return 'unknown';
// };

// const contestFileFilter = (req, file, cb) => {
//     if (!checkMediaType(file.mimetype, req.contest.allowedMediaTypes)) {
//         return cb(new Error(`Only ${req.contest.allowedMediaTypes.join(', ')} files are allowed`), false);
//     }

//     if (file.size > req.contest.maxFileSize) {
//         return cb(new Error(`File size exceeds limit of ${req.contest.maxFileSize / (1024 * 1024)}MB`), false);
//     }

//     const allowedTypes = [
//         'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
//         'video/mp4', 'video/mpeg', 'video/ogg', 'video/webm', 'video/quicktime'
//     ];

//     if (allowedTypes.includes(file.mimetype)) {
//         cb(null, true);
//     } else {
//         cb(new Error('Unsupported file type'), false);
//     }
// };

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         const contestDir = path.join(UPLOAD_DIR, req.params.id);
//         if (!fs.existsSync(contestDir)) {
//             fs.mkdirSync(contestDir, { recursive: true });
//         }
//         cb(null, contestDir);
//     },
//     filename: (req, file, cb) => {
//         const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
//         const extension = path.extname(file.originalname);
//         const safeName = file.originalname.replace(/\s+/g, '_').replace(extension, '');
//         cb(null, `${safeName}-${uniqueSuffix}${extension}`);
//     }
// });

// const upload = multer({
//     storage,
//     fileFilter: contestFileFilter,
//     limits: { fileSize: 100 * 1024 * 1024 }
// });

// // Helper to build file URL
// const buildFileUrl = (fileName) => {
//     return `/uploads/${fileName}`;
// };

// // Submit to contest
// router.post('/:id/submit', contestUpload, upload.single('media'), async (req, res) => {
//     try {
//         const { id: contestId } = req.params;
//         const userId = req.userId;
//         const caption = req.body.caption || '';

//         if (!req.file) {
//             return res.status(400).json({ message: 'Media file is required' });
//         }

//         const mediaType = getMediaType(req.file.mimetype);
//         if (mediaType === 'unknown') {
//             fs.unlinkSync(req.file.path);
//             return res.status(400).json({ message: 'Unsupported media type' });
//         }

//         // Create FileMeta
//         const fileMeta = new FileMeta({
//             fileName: req.file.filename,
//             originalName: req.file.originalname,
//             mimeType: req.file.mimetype,
//             size: req.file.size,
//             path: req.file.path,
//             createdBy: userId,
//             description: caption,
//             //  REMOVED: contestId, isSubmission (optional: keep isSubmission if needed elsewhere)
//             isSubmission: true
//         });

//         await fileMeta.save();

//         // Create Submission
//         const submission = new Submission({
//             userId,
//             contestId,
//             fileId: fileMeta._id,
//             mediaType,
//             caption,
//             status: 'pending'
//         });

//         await submission.save();

//         //  NO MORE updating Contest.submissions!

//         res.status(201).json({
//             success: true,
//             message: 'Submission successful',
//             submission: {
//                 id: submission._id,
//                 contestId: submission.contestId,
//                 mediaType: submission.mediaType,
//                 caption: submission.caption,
//                 status: submission.status,
//                 submittedAt: submission.submittedAt,
//                 file: {
//                     id: fileMeta._id,
//                     fileName: fileMeta.fileName,
//                     originalName: fileMeta.originalName,
//                     mimeType: fileMeta.mimeType,
//                     size: fileMeta.size,
//                     mediaUrl: buildFileUrl(fileMeta.fileName),
//                     thumbnailUrl: mediaType === 'image' ? buildFileUrl(fileMeta.fileName) : null
//                 }
//             }
//         });

//     } catch (error) {
//         console.error('Submission error:', error);

//         if (req.file?.path) {
//             try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
//         }

//         if (error.code === 11000) {
//             return res.status(409).json({
//                 message: 'You have already submitted to this contest'
//             });
//         }

//         res.status(500).json({ message: 'Submission failed', error: error.message });
//     }
// });

// // Get contest submissions
// router.get('/:id/submissions', async (req, res) => {
//     try {
//         const contestId = req.params.id;
//         const userId = req.user?.id || req.headers['x-user-id'];
//         const { status } = req.query;

//         const contest = await Contest.findById(contestId).populate('createdBy', 'username email');
//         if (!contest) {
//             return res.status(404).json({ message: 'Contest not found' });
//         }

//         //  Fetch submissions from Submission model
//         let submissionsQuery = { contestId };
//         if (status) submissionsQuery.status = status;

//         const submissions = await Submission.find(submissionsQuery)
//             .populate('userId', 'username email')
//             .populate('fileId')
//             .sort({ submittedAt: -1 });

//         // Compute count
//         const submissionCount = submissions.length;

//         // User's submission
//         let userSubmission = null;
//         if (userId) {
//             userSubmission = await Submission.findOne({ contestId, userId }).populate('fileId');
//         }

//         res.json({
//             contest: {
//                 id: contest._id,
//                 title: contest.title,
//                 description: contest.description,
//                 startDate: contest.startDate,
//                 endDate: contest.endDate,
//                 isActiveNow: contest.isActiveNow,
//                 isOpenForSubmissions: contest.isOpenForSubmissions,
//                 submissionCount,
//                 maxSubmissionsPerUser: contest.maxSubmissionsPerUser,
//                 allowedMediaTypes: contest.allowedMediaTypes,
//                 maxFileSize: contest.maxFileSize
//             },
//             submissions: submissions.map(sub => ({
//                 ...sub.toObject(),
//                 file: sub.fileId ? {
//                     id: sub.fileId._id,
//                     fileName: sub.fileId.fileName,
//                     originalName: sub.fileId.originalName,
//                     mimeType: sub.fileId.mimeType,
//                     size: sub.fileId.size,
//                     mediaUrl: buildFileUrl(sub.fileId.fileName),
//                     thumbnailUrl: sub.mediaType === 'image' ? buildFileUrl(sub.fileId.fileName) : null
//                 } : null
//             })),
//             userHasSubmitted: !!userSubmission,
//             userSubmission: userSubmission ? {
//                 ...userSubmission.toObject(),
//                 file: userSubmission.fileId ? {
//                     id: userSubmission.fileId._id,
//                     mediaUrl: buildFileUrl(userSubmission.fileId.fileName),
//                     thumbnailUrl: userSubmission.mediaType === 'image' ? buildFileUrl(userSubmission.fileId.fileName) : null
//                 } : null
//             } : null
//         });

//     } catch (error) {
//         console.error('Get submissions error:', error);
//         res.status(500).json({ message: 'Server error', error: error.message });
//     }
// });

// // Get user's submission
// router.get('/:id/my-submission', async (req, res) => {
//     try {
//         const contestId = req.params.id;
//         const userId = req.user?.id || req.headers['x-user-id'];

//         if (!userId) {
//             return res.status(401).json({ message: 'User authentication required' });
//         }

//         const submission = await Submission.findOne({ contestId, userId })
//             .populate('fileId')
//             .populate('contestId', 'title description');

//         if (!submission) {
//             return res.status(404).json({ message: 'No submission found', hasSubmitted: false });
//         }

//         res.json({
//             hasSubmitted: true,
//             submission: {
//                 ...submission.toObject(),
//                 file: submission.fileId ? {
//                     id: submission.fileId._id,
//                     mediaUrl: buildFileUrl(submission.fileId.fileName),
//                     thumbnailUrl: submission.mediaType === 'image' ? buildFileUrl(submission.fileId.fileName) : null
//                 } : null
//             }
//         });

//     } catch (error) {
//         console.error('Get my submission error:', error);
//         res.status(500).json({ message: 'Server error', error: error.message });
//     }
// });

// // Update caption
// router.patch('/submissions/:submissionId', async (req, res) => {
//     try {
//         const { submissionId } = req.params;
//         const userId = req.user?.id || req.headers['x-user-id'];
//         const { caption } = req.body;

//         if (!userId) {
//             return res.status(401).json({ message: 'User authentication required' });
//         }

//         const submission = await Submission.findOne({ _id: submissionId, userId });
//         if (!submission) {
//             return res.status(404).json({ message: 'Submission not found' });
//         }

//         const contest = await Contest.findById(submission.contestId);
//         if (!contest.isOpenForSubmissions) {
//             return res.status(400).json({ message: 'Cannot update after contest ended' });
//         }

//         if (caption !== undefined) {
//             submission.caption = caption;
//             await FileMeta.findByIdAndUpdate(submission.fileId, { description: caption });
//             await submission.save();
//         }

//         res.json({ message: 'Updated successfully', submission });
//     } catch (error) {
//         console.error('Update error:', error);
//         res.status(500).json({ message: 'Server error', error: error.message });
//     }
// });

// // Withdraw submission
// router.delete('/submissions/:submissionId', async (req, res) => {
//     try {
//         const { submissionId } = req.params;
//         const userId = req.user?.id || req.headers['x-user-id'];

//         if (!userId) {
//             return res.status(401).json({ message: 'User authentication required' });
//         }

//         const submission = await Submission.findOne({ _id: submissionId, userId }).populate('fileId');
//         if (!submission) {
//             return res.status(404).json({ message: 'Submission not found' });
//         }

//         const contest = await Contest.findById(submission.contestId);
//         if (!contest.isOpenForSubmissions) {
//             return res.status(400).json({ message: 'Cannot withdraw after contest ended' });
//         }

//         //  No need to update Contest — it has no submissions array!

//         // Delete file
//         if (submission.fileId?.path && fs.existsSync(submission.fileId.path)) {
//             fs.unlinkSync(submission.fileId.path);
//         }

//         // Delete records
//         await FileMeta.findByIdAndDelete(submission.fileId._id);
//         await submission.deleteOne();

//         res.json({ success: true, message: 'Submission withdrawn successfully' });

//     } catch (error) {
//         console.error('Withdraw error:', error);
//         res.status(500).json({ message: 'Server error', error: error.message });
//     }
// });

// module.exports = router;

// routes/contestSubmissions.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const contestUpload = require('../middleware/contestUpload');
const Contest = require('../models/Contest');
const FileMeta = require('../models/FileMeta');
const Submission = require('../models/Submission');
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
    try {
        const { id: contestId } = req.params;
        const userId = req.userId;
        const caption = req.body.caption || '';

        if (!req.file) {
            return res.status(400).json({ message: 'Media file is required' });
        }

        const mediaType = getMediaType(req.file.mimetype);
        if (mediaType === 'unknown') {
            // Temp file may still exist — let service or error handler clean up
            return res.status(400).json({ message: 'Unsupported media type' });
        }

        //  Upload to Cloud (Cloudinary, S3, etc.)
        const cloudFile = await uploadToProvider(req.file);

        // Create FileMeta with cloud data
        const fileMeta = new FileMeta({
            fileName: cloudFile.publicId,        // Cloudinary public_id
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: cloudFile.url,                 // Full cloud URL (e.g., https://res.cloudinary.com/...)
            cloudId: cloudFile.publicId,         // For deletion/transformation
            createdBy: userId,
            description: caption,
            isSubmission: true
            // contestId is not needed — linked via Submission
        });

        await fileMeta.save();

        // Create Submission
        const submission = new Submission({
            userId,
            contestId,
            fileId: fileMeta._id,
            mediaType,
            caption,
            status: 'pending'
        });

        await submission.save();

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
                file: buildFileResponse(fileMeta)
            }
        });

    } catch (error) {
        console.error('Submission error:', error);

        // If file was uploaded to cloud but DB failed, we have an orphan.
        // For production, consider a background job to clean orphans.
        // For now, log and return error.

        res.status(500).json({
            message: 'Submission failed',
            error: error.message
        });
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
router.patch('/submissions/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user?.id || req.headers['x-user-id'];
        const { caption } = req.body;

        if (!userId) {
            return res.status(401).json({ message: 'User authentication required' });
        }

        const submission = await Submission.findOne({ _id: submissionId, userId });
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const contest = await Contest.findById(submission.contestId);
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({ message: 'Cannot update after contest ended' });
        }

        if (caption !== undefined) {
            submission.caption = caption;
            await FileMeta.findByIdAndUpdate(submission.fileId, { description: caption });
            await submission.save();
        }

        res.json({ message: 'Updated successfully', submission });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Withdraw submission
router.delete('/submissions/:submissionId', async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user?.id || req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ message: 'User authentication required' });
        }

        const submission = await Submission.findOne({ _id: submissionId, userId }).populate('fileId');
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const contest = await Contest.findById(submission.contestId);
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({ message: 'Cannot withdraw after contest ended' });
        }

        //  Delete from Cloudinary (or other provider)
        if (submission.fileId?.cloudId) {
            await deleteFromProvider(submission.fileId.cloudId);
        }

        // Delete DB records
        await FileMeta.findByIdAndDelete(submission.fileId._id);
        await submission.deleteOne();

        res.json({ success: true, message: 'Submission withdrawn successfully' });

    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;