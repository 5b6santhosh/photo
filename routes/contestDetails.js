// routes/contestDetails.js — COMPLETE FIXED FILE
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Contest = require('../models/Contest');
const ContestEntry = require('../models/ContestEntry');
const Payment = require('../models/Payment');
const FileMeta = require('../models/FileMeta');
const { authMiddleware } = require('../middleware/auth');
const Submission = require('../models/Submission');
const JudgeDecision = require('../models/JudgeDecision');
const { getUserBadgeInfo } = require('../utils/badgeUtils');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPER: resolves winners for any contestId after the contest ends.
// Handles the case where JudgeDecision.userId is null (bad data from selectWinners).
// ─────────────────────────────────────────────────────────────────────────────
async function resolveWinners(contestId, now, endDate) {
    if (now < endDate) return [];

    const judgeDecisions = await JudgeDecision.find({
        contestId: new mongoose.Types.ObjectId(contestId),
        finalDecision: 'winner'
    })
        .populate('userId', 'name firstName lastName username email avatarUrl profileImage avatar photo')
        .sort({ position: 1 })
        .limit(3)
        .lean();

    if (judgeDecisions.length === 0) return [];

    const winners = [];

    for (const decision of judgeDecisions) {
        const entryObjectId = decision.entryId;
        let mediaUrl = null;
        let thumbnailUrl = null;

        let resolvedUserData = decision.userId || null;
        let resolvedUserId = decision.userId?._id?.toString() || null;

        // ── TIER 1: Try Submission model ──────────────────────────────────
        if (entryObjectId) {
            const sub = await Submission.findById(entryObjectId)
                .select('fileId mediaUrl thumbnailUrl userId')
                .lean();

            if (sub) {
                // Get media from Submission → FileMeta
                if (sub.fileId) {
                    const fileMeta = await FileMeta.findById(sub.fileId)
                        .select('path thumbnailUrl')
                        .lean();
                    if (fileMeta) {
                        mediaUrl = fileMeta.path;
                        thumbnailUrl = fileMeta.thumbnailUrl || fileMeta.path;
                    }
                } else if (sub.mediaUrl) {
                    mediaUrl = sub.mediaUrl;
                    thumbnailUrl = sub.thumbnailUrl || sub.mediaUrl;
                }

                if (!resolvedUserId && sub.userId) {
                    resolvedUserId = sub.userId.toString();
                }
            }
        }

        // ── TIER 2: Try ContestEntry model ────────────────────────────────
        // (entryId was saved as ContestEntry._id in many cases)
        if (entryObjectId && (!mediaUrl || !resolvedUserId)) {
            const ce = await ContestEntry.findById(entryObjectId)
                .select('photos videos userId')
                .lean();

            if (ce) {
                if (!mediaUrl) {
                    const mediaIds = [...(ce.photos || []), ...(ce.videos || [])].filter(Boolean);
                    if (mediaIds.length > 0) {
                        const fileMeta = await FileMeta.findById(mediaIds[0])
                            .select('path thumbnailUrl')
                            .lean();
                        if (fileMeta) {
                            mediaUrl = fileMeta.path;
                            thumbnailUrl = fileMeta.thumbnailUrl || fileMeta.path;
                        }
                    }
                }

                if (!resolvedUserId && ce.userId) {
                    resolvedUserId = ce.userId.toString();
                }
            }
        }

        // ── Resolve user name/avatar if populate returned null ────────────
        // This happens when JudgeDecision.userId was null in the DB.
        // resolvedUserId may now be populated from Submission or ContestEntry above.
        // if (!resolvedUserData && resolvedUserId) {
        //     resolvedUserData = await User.findById(resolvedUserId)
        //         .select('name firstName username avatarUrl')
        //         .lean();
        // }

        if (!resolvedUserData && resolvedUserId) {
            try {
                // Try the User model — adjust the path if needed for your project
                const UserModel = require('../models/User');
                resolvedUserData = await UserModel.findById(resolvedUserId)
                    .select('name firstName lastName username email avatarUrl profileImage avatar photo')
                    .lean();

                // DEBUG: uncomment this line if userName is still "Unknown"
                // console.log(`[resolveWinners] userId=${resolvedUserId} userDoc=`, JSON.stringify(resolvedUserData));
            } catch (e) {
                console.warn('[resolveWinners] User model lookup failed:', e.message);
            }
        }

        // ── TIER 3: FileMeta fallback by userId + contestId ───────────────
        // NOTE: This now uses resolvedUserId (not decision.userId?._id)
        // so it runs even when JudgeDecision.userId was null.
        if (!mediaUrl && resolvedUserId) {
            const fallbackFile = await FileMeta.findOne({
                event: new mongoose.Types.ObjectId(contestId),
                createdBy: new mongoose.Types.ObjectId(resolvedUserId),
                isSubmission: true,
                archived: false,
                visibility: 'public'
            })
                .sort({ uploadedAt: -1 })
                .select('path thumbnailUrl')
                .lean();

            if (fallbackFile) {
                mediaUrl = fallbackFile.path;
                thumbnailUrl = fallbackFile.thumbnailUrl || fallbackFile.path;
            }
        }

        // ── TIER 4: Last resort — any FileMeta for this contest entry ─────
        // No userId filter — just find the FileMeta that matches the entryId
        if (!mediaUrl && entryObjectId) {
            const lastResort = await FileMeta.findOne({
                event: new mongoose.Types.ObjectId(contestId),
                isSubmission: true,
            })
                .sort({ uploadedAt: -1 })
                .select('path thumbnailUrl createdBy')
                .lean();

            if (lastResort) {
                mediaUrl = lastResort.path;
                thumbnailUrl = lastResort.thumbnailUrl || lastResort.path;
                // Also recover userId from FileMeta if nothing else worked
                if (!resolvedUserId && lastResort.createdBy) {
                    resolvedUserId = lastResort.createdBy.toString();
                    if (!resolvedUserData) {
                        resolvedUserData = await User.findById(resolvedUserId)
                            .select('name firstName username avatarUrl')
                            .lean();
                    }
                }
            }
        }

        winners.push({
            position: decision.position,
            entryId: entryObjectId?.toString() || null,
            userId: resolvedUserId,
            userName: resolvedUserData?.name
                || resolvedUserData?.firstName
                || resolvedUserData?.username
                || 'Unknown',
            userAvatar: resolvedUserData?.avatarUrl || null,
            mediaUrl,
            thumbnailUrl,
            aiScore: decision.aiScore || null,
            aiRank: decision.aiRank || null,
            overrideReason: decision.overrideReason || null,
        });
    }

    return winners;
}


// ─────────────────────────────────────────────────────────────────────────────

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
        isFavorite,
        aspectRatio: photo.aspectRatio || 9 / 16,
        blurHash: photo.blurHash || null,
        userName,
        isCurated,
        isLiked,
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
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /:contestId/details
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:contestId/details', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user?.id || null;
        console.log('Contest details request:', { contestId, userId: userId || 'anonymous' });

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ success: false, message: 'Invalid contest ID' });
        }

        const contest = await Contest.findById(contestId).lean();
        if (!contest) {
            return res.status(404).json({ success: false, message: 'Contest not found' });
        }

        const now = new Date();
        const endDate = new Date(contest.endDate);
        const startDate = new Date(contest.startDate);

        // ── Winners ───────────────────────────────────────────────────────
        const winners = await resolveWinners(contestId, now, endDate);

        // ── Highlight photos ──────────────────────────────────────────────
        let highlightPhotos = [];
        if (contest.highlightPhotos?.length > 0) {
            const photos = await FileMeta.find({ _id: { $in: contest.highlightPhotos } })
                .select('_id path thumbnailPath title subtitle description location uploadedAt peopleCount category likesCount aspectRatio blurHash')
                .lean();

            const photoMap = {};
            photos.forEach(p => photoMap[p._id.toString()] = p);

            highlightPhotos = contest.highlightPhotos
                .map(id => formatHighlightPhoto(photoMap[id.toString()], contest.endDate, { isCurated: true }))
                .filter(Boolean);
        }

        // ── User submissions ──────────────────────────────────────────────
        let userSubmissions = [];
        let contestEntry = null;

        if (userId) {
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

                const allMediaIds = [...(entry.photos || []), ...(entry.videos || [])].filter(Boolean);
                if (allMediaIds.length > 0) {
                    const mediaDocs = await FileMeta.find({ _id: { $in: allMediaIds } }).lean();
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

            const submissions = await Submission.find({
                userId: new mongoose.Types.ObjectId(userId),
                contestId: new mongoose.Types.ObjectId(contestId)
            }).lean();

            if (submissions.length > 0 && userSubmissions.length === 0) {
                const fileIds = submissions.map(s => s.fileId).filter(Boolean);
                if (fileIds.length > 0) {
                    const fileDocs = await FileMeta.find({ _id: { $in: fileIds } }).lean();
                    userSubmissions = fileDocs
                        .map(p => formatHighlightPhoto(p, contest.endDate, {
                            isCurated: false,
                            userName: req.user?.name || req.user?.username || 'You'
                        }))
                        .filter(Boolean);
                }

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
                    userSubmissions = directFiles
                        .map(p => formatHighlightPhoto(p, contest.endDate, {
                            isCurated: false,
                            userName: req.user?.name || req.user?.username || 'You'
                        }))
                        .filter(Boolean);
                }
            }
        }

        // ── Payment status ────────────────────────────────────────────────
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

        const rawBanner = typeof contest.bannerImage === 'string' ? contest.bannerImage.trim() : null;
        const coverImage = highlightPhotos.length > 0
            ? highlightPhotos[0].url
            : (rawBanner || (userSubmissions.length > 0 ? userSubmissions[0].url : null));

        // ── Stats ─────────────────────────────────────────────────────────
        const entryCount = await ContestEntry.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId),
            status: { $in: ['submitted', 'approved', 'rejected', 'pending'] }
        });
        const submissionCount = await Submission.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId)
        });
        const totalSubmissions = Math.max(entryCount, submissionCount) || (entryCount + submissionCount);

        let mySubmissions = 0;
        if (userId) {
            if (contestEntry) {
                mySubmissions = (contestEntry.photos?.length || 0) + (contestEntry.videos?.length || 0);
            }
            if (mySubmissions === 0) {
                mySubmissions = await Submission.countDocuments({
                    userId: new mongoose.Types.ObjectId(userId),
                    contestId: new mongoose.Types.ObjectId(contestId)
                });
            }
        }

        // ── Status ────────────────────────────────────────────────────────
        const dateBasedIsUpcoming = now < startDate;
        const dateBasedIsCompleted = now > endDate;
        const dateBasedIsActive = !dateBasedIsUpcoming && !dateBasedIsCompleted;

        const isOpenForSubmissions = ['published', 'ongoing'].includes(contest.contestStatus) && dateBasedIsActive;
        const isActive = dateBasedIsActive && isOpenForSubmissions;
        const isUpcoming = dateBasedIsUpcoming;
        const isCompleted = dateBasedIsCompleted || (dateBasedIsActive && !isOpenForSubmissions);

        let timeLabel = '';
        let timeStatus = '';
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

        console.log('Sending response:', {
            userId,
            totalSubmissions,
            mySubmissions,
            hasParticipated: !!contestEntry || mySubmissions > 0,
            highlightCount: highlightPhotos.length,
            userSubmissionCount: userSubmissions.length,
            hasBanner: !!rawBanner,
            winnersCount: winners.length,
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
                isActive,
                isUpcoming,
                isCompleted,
                isOpenForSubmissions,
                timeLabel,
                timeStatus,
                totalSubmissions,
                mySubmissions,
                highlightPhotos,
                userSubmissions,
                userBadge: userId ? await getUserBadgeInfo(userId) : null,
                winners,
                winnersAnnounced: winners.length > 0,
                bannerImage: rawBanner || null,
                coverImage,
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


// ─────────────────────────────────────────────────────────────────────────────
// GET /:contestId/payment-status
// ─────────────────────────────────────────────────────────────────────────────
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
            return res.json({ status: 'not_found', message: 'No payment record found' });
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


// ─────────────────────────────────────────────────────────────────────────────
// GET /:contestId/entry-status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:contestId/entry-status', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contestEntry = await ContestEntry.findOne({ userId, contestId });
        if (!contestEntry) {
            return res.json({ status: 'not_submitted', message: 'No submission found' });
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


// ─────────────────────────────────────────────────────────────────────────────
// POST /:contestId/submit
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:contestId/submit', authMiddleware, upload.single('media'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { contestId } = req.params;
        const userId = req.user.id;
        const { caption } = req.body;
        const file = req.file;

        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ success: false, message: 'Invalid contest ID' });
        }
        if (!file) {
            return res.status(400).json({ success: false, message: 'Media file is required' });
        }

        const contest = await Contest.findById(contestId).session(session);
        if (!contest) {
            return res.status(404).json({ success: false, message: 'Contest not found' });
        }
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({ success: false, message: 'Contest is not open for submissions' });
        }

        const isVideo = file.mimetype.startsWith('video/');
        const mediaType = isVideo ? 'video' : 'image';
        if (!contest.allowedMediaTypes.includes(mediaType)) {
            return res.status(400).json({
                success: false,
                message: `This contest only allows: ${contest.allowedMediaTypes.join(', ')}`
            });
        }

        const existingEntry = await ContestEntry.findOne({ userId, contestId }).session(session);
        if (existingEntry && ['submitted', 'paid'].includes(existingEntry.status)) {
            return res.status(400).json({ success: false, message: 'You have already submitted to this contest' });
        }

        let paymentId = null;
        if (contest.entryFee && contest.entryFee > 0) {
            const payment = await Payment.findOne({ userId, contestId, status: 'verified', used: false }).session(session);
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
            const freePayment = await Payment.create([{
                userId, contestId, status: 'verified', amount: 0, used: true, type: 'free'
            }], { session });
            paymentId = freePayment[0]._id;
        }

        let mediaUrl = `/uploads/${file.filename}`;
        let thumbnailUrl = `/uploads/${file.filename}`;
        let cloudId = file.filename;

        const [fileMeta] = await FileMeta.create([{
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: mediaUrl,
            thumbnailUrl,
            createdBy: userId,
            event: contestId,
            isSubmission: true,
            isVideo,
            visibility: 'public',
            archived: false,
            title: caption || '',
            category: contest.category || 'other',
            cloudId,
        }], { session });

        await ContestEntry.findOneAndUpdate(
            { contestId, userId },
            { $set: { paymentId, status: 'submitted', submittedAt: new Date() } },
            { upsert: true, session, new: true }
        );

        await Contest.findByIdAndUpdate(
            contestId,
            { $inc: { totalSubmissions: 1 }, $addToSet: { participants: userId } },
            { session }
        );

        await session.commitTransaction();

        return res.status(201).json({
            success: true,
            message: 'Submission successful',
            submission: {
                id: fileMeta._id.toString(),
                contestId,
                mediaType,
                caption: caption || '',
                status: 'submitted',
                submittedAt: fileMeta.uploadedAt,
                file: {
                    id: fileMeta._id.toString(),
                    mimeType: file.mimetype,
                    mediaUrl,
                    thumbnailUrl,
                }
            }
        });

    } catch (err) {
        await session.abortTransaction();
        console.error('SUBMIT CONTEST ENTRY ERROR:', err);
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
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /my
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const submissions = await Submission.find({ userId })
            .populate({ path: 'contestId', populate: { path: 'rules', select: 'title description' } })
            .populate('fileId', 'thumbnailUrl path')
            .sort({ createdAt: -1 })
            .lean();

        const contestMap = new Map();

        for (const sub of submissions) {
            const c = sub.contestId;
            if (!c) continue;

            const now = new Date();
            let status = 'upcoming';
            if (now >= c.startDate && now <= c.endDate) status = 'active';
            else if (now > c.endDate) status = 'completed';

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
                    placement: 'participant',
                    endDate: c.endDate,
                    hasHighlights: status === 'completed',
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

            if (placement === 'winner' || (placement === 'finalist' && entry.placement === 'participant')) {
                entry.placement = placement;
            }
        }

        res.json({ success: true, contests: Array.from(contestMap.values()) });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /:contestId/overview
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:contestId/overview', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        validateObjectId(contestId, 'contestId');

        const contest = await Contest.findById(contestId)
            .populate('rules', 'title description prizeDescription theme')
            .lean();

        if (!contest) {
            return res.status(404).json({ success: false, error: 'Contest not found' });
        }

        const mySubmissions = await Submission.find({
            contestId: new mongoose.Types.ObjectId(contestId),
            userId: new mongoose.Types.ObjectId(userId),
        }).sort({ createdAt: -1 }).lean();

        const resolvedSubmissions = await Promise.all(
            mySubmissions.map(async (sub) => {
                let thumbnailUrl = sub.thumbnailUrl ?? null;

                if (!thumbnailUrl && sub.fileId) {
                    const file = await FileMeta.findById(sub.fileId).select('thumbnailUrl path').lean();
                    thumbnailUrl = file?.thumbnailUrl ?? file?.path ?? null;
                }
                if (!thumbnailUrl && sub.metadata?.entryId) {
                    const file = await FileMeta.findById(sub.metadata.entryId).select('thumbnailUrl path').lean();
                    thumbnailUrl = file?.thumbnailUrl ?? file?.path ?? null;
                }
                if (!thumbnailUrl) {
                    const file = await FileMeta.findOne({
                        event: new mongoose.Types.ObjectId(contestId),
                        createdBy: new mongoose.Types.ObjectId(userId),
                        isSubmission: true,
                        archived: false,
                    }).select('thumbnailUrl path').lean();
                    thumbnailUrl = file?.thumbnailUrl ?? file?.path ?? null;
                }

                return {
                    id: sub._id,
                    thumbnail: thumbnailUrl,
                    status: sub.status ?? null,
                    verdict: sub.verdict ?? null,
                    aiScore: sub.aiScore ?? null,
                    submittedAt: sub.submittedAt
                        ? new Date(sub.submittedAt).toISOString()
                        : sub.createdAt ? new Date(sub.createdAt).toISOString() : null,
                };
            })
        );

        const [submissionCount, entryCount] = await Promise.all([
            Submission.countDocuments({ contestId: new mongoose.Types.ObjectId(contestId) }),
            ContestEntry.countDocuments({ contestId: new mongoose.Types.ObjectId(contestId) }),
        ]);
        const totalEntries = Math.max(submissionCount, entryCount);

        let placement = 'participant';
        let placementPosition = null;
        let judgeDecision = null;

        const mySubIds = mySubmissions.map(s => s._id);
        const myEntry = await ContestEntry.findOne({
            contestId: new mongoose.Types.ObjectId(contestId),
            userId: new mongoose.Types.ObjectId(userId),
        }).lean();

        const searchIds = [
            ...mySubIds,
            ...(myEntry ? [myEntry._id] : []),
        ].map(id => new mongoose.Types.ObjectId(id.toString()));

        if (searchIds.length > 0) {
            judgeDecision = await JudgeDecision.findOne({
                contestId: new mongoose.Types.ObjectId(contestId),
                entryId: { $in: searchIds },
                finalDecision: 'winner',
            }).lean();

            if (judgeDecision) {
                placement = judgeDecision.position === 1 ? 'winner' : 'finalist';
                placementPosition = judgeDecision.position;
            } else {
                const bestSub = mySubmissions.find(s => ['winner', 'shortlisted'].includes(s.status));
                if (bestSub) placement = bestSub.status === 'winner' ? 'winner' : 'finalist';
            }
        }

        const now = new Date();
        const endDate = new Date(contest.endDate);
        const phase3Start = new Date(endDate);
        phase3Start.setDate(phase3Start.getDate() + 3);
        const resultsVisible = now >= endDate; // show results as soon as contest ends

        // ── Winners — uses the same shared helper ─────────────────────────
        const winners = await resolveWinners(contestId, now, endDate);

        // ── Highlights ────────────────────────────────────────────────────
        let highlights = [];
        if (resultsVisible) {
            const topEntries = await Submission.find({
                contestId: new mongoose.Types.ObjectId(contestId),
                status: { $in: ['shortlisted', 'winner', 'approved'] },
            }).sort({ aiScore: -1, votes: -1 }).limit(10).lean();

            highlights = await Promise.all(
                topEntries.map(async (e) => {
                    let thumbUrl = e.thumbnailUrl ?? null;
                    if (!thumbUrl && e.fileId) {
                        const file = await FileMeta.findById(e.fileId).select('thumbnailUrl path').lean();
                        thumbUrl = file?.thumbnailUrl ?? file?.path ?? null;
                    }
                    return {
                        entryId: e._id.toString(),
                        thumbnailUrl: thumbUrl,
                        rank: e.prizePosition ?? null,
                        aiScore: e.aiScore ?? null,
                        isMyEntry: e.userId?.toString() === userId.toString(),
                    };
                })
            );
        }

        const mySubmissionsSortedAsc = [...mySubmissions].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        const timeline = buildUserTimeline(mySubmissionsSortedAsc, judgeDecision);

        res.json({
            success: true,
            contest: {
                id: contest._id,
                title: contest.rules?.title ?? contest.title ?? null,
                subtitle: contest.rules?.description ?? contest.subtitle ?? null,
                prizeText: contest.rules?.prizeDescription ?? contest.prizeText ?? 'Win curated badge + spotlight',
                status: getContestStatus(contest, now),
                theme: contest.rules?.theme ?? null,
                totalEntries,
                myShots: resolvedSubmissions.length,
                placement,
                placementPosition,
                startDate: contest.startDate?.toISOString() ?? null,
                endDate: contest.endDate?.toISOString() ?? null,
                phase3Start: phase3Start.toISOString(),
                resultsVisible,
                timeLabel: calculateTimeLabel(contest, now),
                mySubmissions: resolvedSubmissions,
                highlights,
                timeline,
                userBadge: userId ? await getUserBadgeInfo(userId) : null,
                winners,
                winnersAnnounced: winners.length > 0,
            },
        });

    } catch (error) {
        console.error('Get contest overview error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function validateObjectId(id, fieldName = 'id') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid ${fieldName}: must be a valid MongoDB ObjectId`);
    }
}

function getContestStatus(contest, now) {
    if (now < new Date(contest.startDate)) return 'upcoming';
    if (now <= new Date(contest.endDate)) return 'active';
    return 'completed';
}

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

function buildUserTimeline(submissions, judgeDecision) {
    const timeline = [];
    if (submissions.length === 0) return timeline;

    timeline.push({
        step: 'joined',
        label: 'Joined contest',
        description: `You added your first shot on ${new Date(submissions[0].createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        completed: true,
        timestamp: new Date(submissions[0].createdAt).toISOString(),
    });

    const shortlisted = submissions.filter(s => s.status === 'shortlisted' || s.status === 'winner');
    if (shortlisted.length > 0) {
        timeline.push({
            step: 'shortlisted',
            label: 'Curated in highlights',
            description: `${shortlisted.length} of your shots were shortlisted for the reel`,
            completed: true,
            timestamp: new Date(shortlisted[0].createdAt).toISOString(),
        });
    }

    if (judgeDecision) {
        timeline.push({
            step: 'results',
            label: judgeDecision.position === 1 ? 'You won!' : 'Finalist placement',
            description: judgeDecision.position === 1
                ? 'Congratulations! You won this contest'
                : `You placed #${judgeDecision.position} in this contest`,
            completed: true,
            timestamp: judgeDecision.selectedAt ? new Date(judgeDecision.selectedAt).toISOString() : null,
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