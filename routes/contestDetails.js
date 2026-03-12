
// routes/contestDetails.js (or add to your existing contest routes)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Contest = require('../models/Contest');
const ContestEntry = require('../models/ContestEntry');
const Payment = require('../models/Payment');
const FileMeta = require('../models/FileMeta');
const { authMiddleware: authMiddleware } = require('../middleware/auth');
const Submission = require('../models/Submission');
const JudgeDecision = require('../models/JudgeDecision');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function formatHighlightPhoto(photo, contestEndDate, options = {}) {
    if (!photo) return null;

    const {
        isCurated = photo.isCurated || false,
        userName = photo.userName || null,
        isLiked = photo.isLiked || false,
        isFavorite = photo.isFavorite || false
    } = options;

    const baseUrl = (process.env.CDN_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');

    const toFullUrl = (p) => {
        if (!p) return '';
        if (p.startsWith('http://') || p.startsWith('https://')) return p;
        return `${baseUrl}/${p.replace(/^\//, '')}`;
    };

    const url = toFullUrl(photo.path || photo.url);
    const thumbnailUrl = toFullUrl(photo.thumbnailPath || photo.thumbnailUrl) || url;

    if (!url) return null;

    return {
        id: photo._id?.toString() || photo.id?.toString() || '',
        url,
        thumbnailUrl,
        title: photo.title || 'Untitled',
        subtitle: photo.subtitle || photo.description || '',
        location: photo.location || '',
        date: photo.uploadedAt ? new Date(photo.uploadedAt).toISOString() : new Date(contestEndDate).toISOString(),
        peopleCount: photo.peopleCount || 0,
        category: photo.category || 'other',
        likesCount: photo.likesCount || 0,
        isFavorite: isFavorite,
        aspectRatio: photo.aspectRatio || 9 / 16,
        blurHash: photo.blurHash || null,
        userName: userName,
        isCurated: isCurated,
        isLiked: isLiked,
    };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/temp/'),
    filename: (req, file, cb) => {
        const unique = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, unique);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
        allowed.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Invalid file type'));
    }
});


router.get('/:contestId/details', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user?.id || null;
        console.log('Contest details request:', { contestId, userId: userId || 'anonymous' });

        // Validate contestId
        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid contest ID'
            });
        }

        // Fetch contest with highlight photos populated
        const contest = await Contest.findById(contestId).lean();

        if (!contest) {
            return res.status(404).json({
                success: false,
                message: 'Contest not found'
            });
        }

        // Fetch actual photo documents for highlights
        let highlightPhotos = [];
        if (contest.highlightPhotos?.length > 0) {
            const photos = await FileMeta.find({
                _id: { $in: contest.highlightPhotos }
            })
                .select('_id path thumbnailPath title subtitle description location uploadedAt peopleCount category likesCount aspectRatio blurHash')
                .lean();

            // Maintain order from contest.highlightPhotos array
            const photoMap = {};
            photos.forEach(p => photoMap[p._id.toString()] = p);

            highlightPhotos = contest.highlightPhotos
                .map(id => formatHighlightPhoto(photoMap[id.toString()], contest.endDate, {
                    isCurated: true
                }))
                .filter(p => p !== null);
        }

        // 2. FETCH USER'S SUBMISSIONS FOR THIS CONTEST (What they actually submitted)
        let userSubmissions = [];
        let contestEntry = null;

        if (userId) {
            // Try ContestEntry first (your current model)
            const entry = await ContestEntry.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                contestId: new mongoose.Types.ObjectId(contestId)
            }).lean();

            if (entry) {
                contestEntry = {
                    id: entry._id.toString(),
                    status: entry.status,
                    submittedAt: entry.submittedAt,
                    photos: entry.photos || [],
                    videos: entry.videos || [],
                };

                const allMediaIds = [
                    ...(entry.photos || []),
                    ...(entry.videos || [])
                ].filter(Boolean);

                if (allMediaIds.length > 0) {
                    const mediaDocs = await FileMeta.find({
                        _id: { $in: allMediaIds }
                    }).lean();

                    const mediaMap = {};
                    mediaDocs.forEach(p => mediaMap[p._id.toString()] = p);

                    userSubmissions = [
                        ...(entry.photos || []).map(id => mediaMap[id.toString()]),
                        ...(entry.videos || []).map(id => mediaMap[id.toString()])
                    ]
                        .filter(Boolean)
                        .map(p => formatHighlightPhoto(p, contest.endDate, {
                            isCurated: false,
                            userName: req.user?.name || req.user?.username || 'You'
                        }))
                        .filter(Boolean);
                }
            }

            // Also check Submission model (used in home route)
            const submissions = await Submission.find({
                userId: new mongoose.Types.ObjectId(userId),
                contestId: new mongoose.Types.ObjectId(contestId)
            }).lean();

            if (submissions.length > 0 && userSubmissions.length === 0) {
                // Gather all fileIds from submissions
                const fileIds = submissions
                    .map(s => s.fileId)
                    .filter(Boolean);

                if (fileIds.length > 0) {
                    const fileDocs = await FileMeta.find({
                        _id: { $in: fileIds }
                    }).lean();

                    userSubmissions = fileDocs.map(p =>
                        formatHighlightPhoto(p, contest.endDate, {
                            isCurated: false,
                            userName: req.user?.name || req.user?.username || 'You'
                        })
                    ).filter(Boolean);
                }

                // Build contestEntry from the first submission if we don't have one
                if (!contestEntry) {
                    const firstSub = submissions[0];
                    contestEntry = {
                        id: firstSub._id.toString(),
                        status: firstSub.status || 'submitted',
                        submittedAt: firstSub.submittedAt || firstSub.createdAt,
                        photos: submissions.map(s => s.fileId).filter(Boolean),
                        videos: [],
                    };
                }
            }

            if (userSubmissions.length === 0) {
                const directFiles = await FileMeta.find({
                    event: new mongoose.Types.ObjectId(contestId),
                    createdBy: new mongoose.Types.ObjectId(userId),
                    isSubmission: true
                }).lean();

                if (directFiles.length > 0) {
                    userSubmissions = directFiles.map(p =>
                        formatHighlightPhoto(p, contest.endDate, {
                            isCurated: false,
                            userName: req.user?.name || req.user?.username || 'You'
                        })
                    ).filter(Boolean);
                }
            }


        }



        // Payment status (only if authenticated)
        let paymentStatus = null;
        if (userId) {
            const payment = await Payment.findOne({
                userId,
                contestId,
                status: { $in: ['pending', 'verified', 'completed'] }
            }).sort({ createdAt: -1 }).lean();

            if (payment) {
                paymentStatus = {
                    status: payment.status,
                    paymentId: payment.paymentId,
                    orderId: payment.orderId,
                    amount: payment.amount,
                    currency: payment.currency,
                    paidAt: payment.verifiedAt || payment.createdAt,
                };
            }
        }

        // // User's entry (only if authenticated)
        // if (userId) {
        //     const entry = await ContestEntry.findOne({ userId, contestId }).lean();
        //     if (entry) {
        //         contestEntry = {
        //             id: entry._id.toString(),
        //             status: entry.status,
        //             submittedAt: entry.submittedAt,
        //             photos: entry.photos || [],
        //             videos: entry.videos || [],
        //         };
        //     }
        // }
        // 4. STATS - Count from BOTH models to be safe
        const entryCount = await ContestEntry.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId),
            status: { $in: ['submitted', 'approved', 'rejected', 'pending'] }
        });

        const submissionCount = await Submission.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId)
        });


        // Stats
        const totalSubmissions = Math.max(entryCount, submissionCount) || (entryCount + submissionCount);

        let mySubmissions = 0;
        if (userId) {
            const userEntry = contestEntry;
            if (userEntry) {
                mySubmissions = (userEntry.photos?.length || 0) + (userEntry.videos?.length || 0);
            }
            if (mySubmissions === 0) {
                mySubmissions = await Submission.countDocuments({
                    userId: new mongoose.Types.ObjectId(userId),
                    contestId: new mongoose.Types.ObjectId(contestId)
                });
            }
        }

        // Status calculation - PRIORITIZE DATES over isOpenForSubmissions for timeLabel consistency
        const now = new Date();
        const startDate = new Date(contest.startDate);
        const endDate = new Date(contest.endDate);

        // Date-based status (what users see)
        const dateBasedIsUpcoming = now < startDate;
        const dateBasedIsCompleted = now > endDate;
        const dateBasedIsActive = !dateBasedIsUpcoming && !dateBasedIsCompleted;

        // Functional status (can they actually submit?)
        const isOpenForSubmissions = ['published', 'ongoing'].includes(contest.contestStatus) && dateBasedIsActive;
        const isActive = dateBasedIsActive && isOpenForSubmissions;
        const isUpcoming = dateBasedIsUpcoming;
        const isCompleted = dateBasedIsCompleted || (dateBasedIsActive && !isOpenForSubmissions);

        // Time label - ALWAYS based on dates, not submission status
        let timeLabel = '';
        let timeStatus = ''; // 'upcoming', 'active', 'completed' for UI styling

        if (dateBasedIsUpcoming) {
            const daysUntil = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysUntil === 1 ? 'Starts in 1 day' : `Starts in ${daysUntil} days`;
            timeStatus = 'upcoming';
        } else if (dateBasedIsActive) {
            const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysLeft === 0 ? 'Ends today' : daysLeft === 1 ? 'Ends in 1 day' : `Ends in ${daysLeft} days`;
            timeStatus = 'active';
        } else {
            const daysAgo = Math.floor((now - endDate) / (1000 * 60 * 60 * 24));
            timeLabel = daysAgo === 0 ? 'Ended today' : daysAgo === 1 ? 'Ended 1 day ago' : `Ended ${daysAgo} days ago`;
            timeStatus = 'completed';
        }

        // Override if submissions are closed but contest is date-active
        // let displayStatus = timeStatus;
        // let statusBadge = isActive ? 'Active' : (isUpcoming ? 'Upcoming' : 'Completed');

        // // If date says active but submissions are closed, show "Ending Soon" or keep date-based label
        // if (dateBasedIsActive && !isOpenForSubmissions) {
        //     statusBadge = 'Closing Soon';
        // }
        console.log('Sending response:', {
            userId,
            totalSubmissions,
            mySubmissions,
            hasParticipated: !!contestEntry || mySubmissions > 0,
            highlightCount: highlightPhotos.length,
            userSubmissionCount: userSubmissions.length
        });

        res.json({
            success: true,
            data: {
                id: contest._id.toString(),
                title: contest.title,
                subtitle: contest.subtitle || contest.description,
                description: contest.description,
                prizeText: contest.prizeText || (contest.entryFee > 0 ? `₹${contest.entryFee}` : 'Free entry'),
                entryFee: contest.entryFee || 0,
                startDate: contest.startDate,
                endDate: contest.endDate,
                isActive,           // Can user submit?
                isUpcoming,         // Before start date?
                isCompleted,        // After end date or closed?
                isOpenForSubmissions, // Explicit flag
                timeLabel,          // Date-based label
                timeStatus,         // 'upcoming' | 'active' | 'completed'
                // displayStatus,      // For UI theming
                // statusBadge,        // Text for badge
                totalSubmissions,
                mySubmissions,
                highlightPhotos,
                userSubmissions,
                coverImage: highlightPhotos.length > 0 ? highlightPhotos[0].url :
                    (userSubmissions.length > 0 ? userSubmissions[0].url : null),
                contestEntry,
                paymentStatus,
                hasParticipated: !!contestEntry || mySubmissions > 0,
                category: contest.category,
                tags: contest.tags || [],
                rules: contest.rules,
                prizes: contest.prizes,
                createdAt: contest.createdAt,
                updatedAt: contest.updatedAt,
            }
        });

    } catch (err) {
        console.error('GET CONTEST DETAILS ERROR:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contest details',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});


// GET endpoint specifically for checking payment status
router.get('/:contestId/payment-status', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const payment = await Payment.findOne({
            userId,
            contestId,
            status: { $in: ['pending', 'verified'] }
        }).sort({ createdAt: -1 });

        if (!payment) {
            return res.json({
                status: 'not_found',
                message: 'No payment record found'
            });
        }

        res.json({
            status: payment.status,
            paymentId: payment.paymentId,
            orderId: payment.orderId,
            amount: payment.amount,
            currency: payment.currency,
            verifiedAt: payment.verifiedAt,
            createdAt: payment.createdAt
        });

    } catch (err) {
        console.error('GET PAYMENT STATUS ERROR:', err);
        res.status(500).json({
            message: 'Failed to fetch payment status',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});

// GET endpoint for checking contest entry status
router.get('/:contestId/entry-status', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contestEntry = await ContestEntry.findOne({
            userId,
            contestId
        });

        if (!contestEntry) {
            return res.json({
                status: 'not_submitted',
                message: 'No submission found'
            });
        }

        res.json({
            status: contestEntry.status,
            submittedAt: contestEntry.submittedAt,
            photos: contestEntry.photos,
            videos: contestEntry.videos,
            metadata: contestEntry.metadata,
            feedback: contestEntry.feedback
        });

    } catch (err) {
        console.error('GET ENTRY STATUS ERROR:', err);
        res.status(500).json({
            message: 'Failed to fetch entry status',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});

router.post(
    '/:contestId/submit',
    authMiddleware,
    upload.single('media'),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { contestId } = req.params;
            const userId = req.user.id;
            const { caption } = req.body;
            const file = req.file;

            // ── 1. Basic validation ──────────────────────────────────────────
            if (!mongoose.Types.ObjectId.isValid(contestId)) {
                return res.status(400).json({ success: false, message: 'Invalid contest ID' });
            }

            if (!file) {
                return res.status(400).json({ success: false, message: 'Media file is required' });
            }

            // ── 2. Load contest ──────────────────────────────────────────────
            const contest = await Contest.findById(contestId).session(session);
            if (!contest) {
                return res.status(404).json({ success: false, message: 'Contest not found' });
            }

            if (!contest.isOpenForSubmissions) {
                return res.status(400).json({ success: false, message: 'Contest is not open for submissions' });
            }

            // Check allowed media types
            const isVideo = file.mimetype.startsWith('video/');
            const mediaType = isVideo ? 'video' : 'image';
            if (!contest.allowedMediaTypes.includes(mediaType)) {
                return res.status(400).json({
                    success: false,
                    message: `This contest only allows: ${contest.allowedMediaTypes.join(', ')}`
                });
            }

            // ── 3. Check duplicate submission ────────────────────────────────
            const existingEntry = await ContestEntry.findOne({ userId, contestId }).session(session);
            if (existingEntry && ['submitted', 'paid'].includes(existingEntry.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already submitted to this contest'
                });
            }

            // ── 4. Payment check ─────────────────────────────────────────────
            let paymentId = null;

            if (contest.entryFee && contest.entryFee > 0) {
                const payment = await Payment.findOne({
                    userId,
                    contestId,
                    status: 'verified',
                    used: false
                }).session(session);

                if (!payment) {
                    return res.status(402).json({
                        success: false,
                        message: 'Payment required. Please complete payment first.',
                        entryFee: contest.entryFee
                    });
                }

                payment.used = true;
                await payment.save({ session });
                paymentId = payment._id;
            } else {
                // Free contest — create a dummy/free payment record or use a sentinel
                // If paymentId is truly required in your schema, create a free Payment record:
                const freePayment = await Payment.create([{
                    userId,
                    contestId,
                    status: 'verified',
                    amount: 0,
                    used: true,
                    type: 'free'
                }], { session });
                paymentId = freePayment[0]._id;
            }

            // ── 5. Upload file to your storage (Cloudinary / S3 / local) ─────
            // Replace this block with your actual upload logic:
            let mediaUrl, thumbnailUrl, cloudId;

            if (isVideo) {
                // Example: Cloudinary video upload
                // const result = await cloudinary.uploader.upload(file.path, { resource_type: 'video', ... });
                // mediaUrl = result.secure_url;
                // thumbnailUrl = result.secure_url.replace('/upload/', '/upload/so_0/').replace(/\.\w+$/, '.jpg');
                // cloudId = result.public_id;

                mediaUrl = `/uploads/${file.filename}`;       // ← replace with real URL
                thumbnailUrl = `/uploads/${file.filename}`;   // ← replace with thumbnail
                cloudId = file.filename;
            } else {
                // Example: Cloudinary image upload
                // const result = await cloudinary.uploader.upload(file.path, { folder: 'contests' });
                // mediaUrl = result.secure_url;
                // thumbnailUrl = result.secure_url;
                // cloudId = result.public_id;

                mediaUrl = `/uploads/${file.filename}`;       // ← replace with real URL
                thumbnailUrl = `/uploads/${file.filename}`;
                cloudId = file.filename;
            }

            // ── 6. Create FileMeta ← THIS IS THE MISSING PIECE ──────────────
            // Without this, the feed query (FileMeta.find) will never see the submission
            const [fileMeta] = await FileMeta.create([{
                fileName: file.filename,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                path: mediaUrl,              // public URL for feed
                thumbnailUrl: thumbnailUrl,
                createdBy: userId,
                event: contestId,            // ← links to contest, feeds eventTitle in feed
                isSubmission: true,          // ← marks it as a contest submission
                isVideo: isVideo,
                visibility: 'public',        // ← required for feed query
                archived: false,             // ← required for feed query
                title: caption || '',
                category: contest.category || 'other',
                cloudId: cloudId,
            }], { session });

            // ── 7. Create or update ContestEntry ────────────────────────────
            await ContestEntry.findOneAndUpdate(
                { contestId, userId },
                {
                    $set: {
                        paymentId,
                        status: 'submitted',
                        submittedAt: new Date(),
                    }
                },
                { upsert: true, session, new: true }
            );

            // ── 8. Increment contest submission count ────────────────────────
            await Contest.findByIdAndUpdate(
                contestId,
                { $inc: { totalSubmissions: 1 }, $addToSet: { participants: userId } },
                { session }
            );

            await session.commitTransaction();

            // ── 9. Return response matching Flutter's UserEventSubmissionResponse ──
            return res.status(201).json({
                success: true,
                message: 'Submission successful',
                submission: {
                    id: fileMeta._id.toString(),          // Flutter: Submission.id
                    contestId: contestId,
                    mediaType: mediaType,
                    caption: caption || '',
                    status: 'submitted',
                    submittedAt: fileMeta.uploadedAt,
                    file: {
                        id: fileMeta._id.toString(),      // Flutter: FileClass.id
                        mimeType: file.mimetype,
                        mediaUrl: mediaUrl,
                        thumbnailUrl: thumbnailUrl,
                    }
                }
            });

        } catch (err) {
            await session.abortTransaction();
            console.error('SUBMIT CONTEST ENTRY ERROR:', err);

            // Handle duplicate key (race condition on double submit)
            if (err.code === 11000) {
                return res.status(400).json({ success: false, message: 'You have already submitted to this contest' });
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to submit entry',
                error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
            });
        } finally {
            session.endSession();
        }
    }
);

// NEW ROUTE: Add to routes/contest.js
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get all submissions by user with contest data
        const submissions = await Submission.find({ userId })
            .populate({
                path: 'contestId',
                populate: { path: 'rules', select: 'title description' }
            })
            .populate('fileId', 'thumbnailUrl path')
            .sort({ createdAt: -1 })
            .lean();

        // Group by contest to get unique contests user joined
        const contestMap = new Map();

        for (const sub of submissions) {
            const c = sub.contestId;
            if (!c) continue;

            const now = new Date();
            let status = 'upcoming';
            if (now >= c.startDate && now <= c.endDate) status = 'active';
            else if (now > c.endDate) status = 'completed';

            // Determine placement
            let placement = 'participant';
            if (sub.status === 'winner') placement = 'winner';
            else if (sub.status === 'shortlisted') placement = 'finalist';

            if (!contestMap.has(c._id.toString())) {
                contestMap.set(c._id.toString(), {
                    id: c._id,
                    title: c.rules?.title || c.title || 'Untitled Contest',
                    subtitle: c.rules?.description || c.description || '',
                    status,
                    myEntries: 0,
                    placement: 'participant', // Will upgrade if better found
                    endDate: c.endDate,
                    hasHighlights: status === 'completed', // Winners announced
                    submissions: []
                });
            }

            const entry = contestMap.get(c._id.toString());
            entry.myEntries++;
            entry.submissions.push({
                id: sub._id,
                status: sub.status,
                thumbnail: sub.fileId?.thumbnailUrl || sub.fileId?.path,
                verdict: sub.verdict
            });

            // Upgrade placement if this submission has better status
            if (placement === 'winner' ||
                (placement === 'finalist' && entry.placement === 'participant')) {
                entry.placement = placement;
            }
        }

        res.json({
            success: true,
            contests: Array.from(contestMap.values())
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// routes/contest.js - Add this route
router.get('/:contestId/overview', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        // ── 1. Validate ObjectId ──────────────────────────────────────────────────
        validateObjectId(contestId, 'contestId');

        // ── 2. Fetch contest ──────────────────────────────────────────────────────
        const contest = await Contest.findById(contestId)
            .populate('rules', 'title description prizeDescription theme')
            .lean();

        if (!contest) {
            return res.status(404).json({ success: false, error: 'Contest not found' });
        }

        // ── 3. User's submissions for this contest ────────────────────────────────
        const mySubmissions = await Submission.find({
            contestId: new mongoose.Types.ObjectId(contestId),
            userId: new mongoose.Types.ObjectId(userId),
        })
            .populate('fileId', 'thumbnailUrl path title')
            .sort({ createdAt: -1 })
            .lean();

        // ── 4. Total entry count ──────────────────────────────────────────────────
        const totalEntries = await Submission.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId),
        });

        // ── 5. Placement ──────────────────────────────────────────────────────────
        const mySubmissionIds = mySubmissions.map((s) => s._id.toString());

        let placement = 'participant';
        let placementPosition = null;
        let judgeDecision = null;

        if (mySubmissionIds.length > 0) {
            judgeDecision = await JudgeDecision.findOne({
                contestId: new mongoose.Types.ObjectId(contestId),
                entryId: { $in: mySubmissionIds.map(id => new mongoose.Types.ObjectId(id)) },
                finalDecision: 'winner',
            }).lean();

            if (judgeDecision) {
                placement = judgeDecision.position === 1 ? 'winner' : 'finalist';
                placementPosition = judgeDecision.position;
            }
        }

        // ── 6. Phase 3 / results visibility ──────────────────────────────────────
        const now = new Date();
        const phase3Start = new Date(contest.endDate);
        phase3Start.setDate(phase3Start.getDate() + 2);
        const resultsVisible = now >= phase3Start;

        // ── 7. Highlights (only after results are visible) ────────────────────────
        let highlights = [];
        if (resultsVisible) {
            const topEntries = await Submission.find({
                contestId: new mongoose.Types.ObjectId(contestId),
                status: { $in: ['shortlisted', 'winner', 'approved'] },
            })
                .sort({ aiScore: -1, votes: -1 })
                .limit(10)
                .populate('fileId', 'thumbnailUrl')
                .lean();

            highlights = topEntries.map(e => ({
                entryId: e._id.toString(),
                thumbnailUrl: e.fileId?.thumbnailUrl ?? e.thumbnailUrl ?? null,
                rank: e.prizePosition ?? null,
                aiScore: e.aiScore ?? null,
                isMyEntry: e.userId?.toString() === userId.toString(),
            }));
        }

        // ── 8. Timeline ───────────────────────────────────────────────────────────
        // Pass sorted ascending (oldest first) so the first element is the earliest
        const mySubmissionsSortedAsc = [...mySubmissions].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        const timeline = buildUserTimeline(mySubmissionsSortedAsc, judgeDecision);

        // ── 9. Build response ─────────────────────────────────────────────────────
        res.json({
            success: true,
            contest: {
                id: contest._id,
                title: contest.rules?.title ?? contest.title ?? null,
                subtitle: contest.rules?.description ?? null,
                prizeText: contest.rules?.prizeDescription ?? 'Win curated badge + spotlight',
                status: getContestStatus(contest, now),
                theme: contest.rules?.theme ?? null,

                // Stats
                totalEntries,
                myShots: mySubmissions.length,
                placement,
                placementPosition,

                // Dates (ISO strings for safe parsing in Dart)
                startDate: contest.startDate?.toISOString() ?? null,
                endDate: contest.endDate?.toISOString() ?? null,
                phase3Start: phase3Start.toISOString(),
                resultsVisible,
                timeLabel: calculateTimeLabel(contest, now),

                // User's submissions
                mySubmissions: mySubmissions.map((s) => ({
                    id: s._id,
                    thumbnail: s.fileId?.thumbnailUrl ?? null,
                    status: s.status ?? null,
                    verdict: s.verdict ?? null,
                    aiScore: s.aiScore ?? null,
                    submittedAt: s.createdAt?.toISOString() ?? null,
                })),

                // Highlights
                highlights,

                // Journey timeline
                timeline,
            },
        });
    } catch (error) {
        console.error('Get contest overview error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Helper: validate MongoDB ObjectId ───────────────────────────────────────
function validateObjectId(id, fieldName = 'id') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid ${fieldName}: must be a valid MongoDB ObjectId`);
    }
}

// ─── Helper: derive contest phase label ──────────────────────────────────────
function getContestStatus(contest, now) {
    if (now < new Date(contest.startDate)) return 'upcoming';
    if (now <= new Date(contest.endDate)) return 'active';
    return 'completed';
}

// ─── Helper: human-readable time label ───────────────────────────────────────
function calculateTimeLabel(contest, now) {
    const end = new Date(contest.endDate);
    const diff = end - now;

    if (diff > 0) {
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        return days === 1 ? 'Ends tomorrow' : `${days} days left`;
    }

    const phase3 = new Date(end);
    phase3.setDate(phase3.getDate() + 2);
    const resultsDiff = phase3 - now;

    if (resultsDiff > 0) {
        const hours = Math.ceil(resultsDiff / (1000 * 60 * 60));
        return `Results in ${hours}h`;
    }

    return 'Results announced';
}

// ─── Helper: build per-user journey timeline ─────────────────────────────────
/**
 * @param {Array}  submissions  – sorted ascending by createdAt
 * @param {Object} judgeDecision – JudgeDecision doc or null
 * @returns {Array<TimelineItem>}
 */
function buildUserTimeline(submissions, judgeDecision) {
    const timeline = [];

    if (submissions.length === 0) return timeline;

    // Step 1 – Joined
    timeline.push({
        step: 'joined',
        label: 'Joined contest',
        description: `You added your first shot on ${new Date(
            submissions[0].createdAt
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        completed: true,
        // Return ISO string so Dart can parse it with DateTime.tryParse()
        timestamp: new Date(submissions[0].createdAt).toISOString(),
    });

    // Step 2 – Shortlisted
    const shortlisted = submissions.filter(
        (s) => s.status === 'shortlisted' || s.status === 'winner'
    );
    if (shortlisted.length > 0) {
        timeline.push({
            step: 'shortlisted',
            label: 'Curated in highlights',
            description: `${shortlisted.length} of your shots were shortlisted for the reel`,
            completed: true,
            timestamp: new Date(shortlisted[0].createdAt).toISOString(),
        });
    }

    // Step 3 – Results
    if (judgeDecision) {
        timeline.push({
            step: 'results',
            label: judgeDecision.position === 1 ? 'You won!' : 'Finalist placement',
            description:
                judgeDecision.position === 1
                    ? 'Congratulations! You won this contest'
                    : `You placed #${judgeDecision.position} in this contest`,
            completed: true,
            timestamp: judgeDecision.selectedAt
                ? new Date(judgeDecision.selectedAt).toISOString()
                : null,
        });
    } else {
        timeline.push({
            step: 'results',
            label: 'Results pending',
            description: 'Badges and placements will update automatically',
            completed: false,
            timestamp: null,
        });
    }

    return timeline;
}

module.exports = router;