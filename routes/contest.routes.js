// ============================================
// CONTEST API ROUTES - 3 PHASE SYSTEM
// ============================================

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { upload, handleUploadError } = require('../middleware/upload');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { evaluateMedia } = require('../services/mediaEvaluation.service');
const {
    getPublicWinners,
    getAdminPreview,
    selectWinners
} = require('../services/contestRanking.service');
const Contest = require('../models/Contest');
const ContestAppeal = require('../models/ContestAppeal');
const Submission = require('../models/Submission');
const fs = require('fs').promises;
const Payment = require('../models/Payment');
const { uploadToProvider } = require('../services/storageService');
const ContestEntry = require('../models/ContestEntry');

// ============================================
// VALIDATION HELPERS
// ============================================

function validateObjectId(id, fieldName = 'id') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid ${fieldName}: must be a valid MongoDB ObjectId`);
    }
}

async function validateContest(contestId) {
    validateObjectId(contestId, 'contestId');

    // Populate the rules reference
    let contest = await Contest.findById(contestId).populate('rules');

    if (!contest) throw new Error('Contest not found');

    // DEBUG: Log what we got
    console.log('Contest found:', contest._id);
    console.log('contest.rules before fix:', contest.rules ? 'exists' : 'missing');

    // Handle case where rules is not set, not populated, or populated but empty
    let effectiveRules = contest.rules;

    // If rules is an ObjectId (not populated) or null/undefined
    if (effectiveRules instanceof mongoose.Types.ObjectId || !effectiveRules) {
        console.log('⚠️ Rules not populated or missing, attempting to fetch...');

        // Try to fetch by contestId if rules reference exists
        if (effectiveRules) {
            const fetchedRules = await ContestRules.findById(effectiveRules);
            if (fetchedRules) {
                effectiveRules = fetchedRules;
                contest.rules = fetchedRules; // Update contest object
            }
        }
    }

    // If still no valid rules, use defaults
    if (!effectiveRules || typeof effectiveRules !== 'object' || !effectiveRules.theme) {
        console.log('⚠️ Using default rules');
        effectiveRules = {
            theme: 'General',
            keywords: [],
            minEntropy: 0,
            maxEntropy: null,
            preferredColor: null,
            skinRange: null,
            allowPeople: true,
            requireVertical: false,
            maxDurationSeconds: null,
            strictThemeMatch: false,
            autoRejectNSFW: true
        };
        // Don't save defaults to DB, just use for this evaluation
        contest.rules = effectiveRules;
    }

    return contest;
}


// ============================================
// MY CONTESTS
// ============================================

router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        const submissions = await Submission.find({ userId })
            .populate({
                path: 'contestId',
                populate: { path: 'rules', select: 'title description startDate endDate' }
            })
            .populate('fileId', 'thumbnailUrl path')
            .sort({ createdAt: -1 })
            .lean();

        const contestMap = new Map();
        const now = new Date();

        for (const sub of submissions) {
            const c = sub.contestId;
            if (!c) continue;

            const endDate = new Date(c.endDate);
            const phase2Start = new Date(endDate);
            phase2Start.setDate(phase2Start.getDate() + 1);
            const phase3Start = new Date(endDate);
            phase3Start.setDate(phase3Start.getDate() + 2);

            let status = 'upcoming';
            if (now >= new Date(c.startDate) && now <= endDate) {
                status = 'active';
            } else if (now > endDate) {
                status = now >= phase3Start ? 'completed' : 'judging';
            }

            let placement = 'participant';
            if (sub.status === 'winner') placement = 'winner';
            else if (sub.status === 'shortlisted') placement = 'finalist';

            const key = c._id.toString();
            if (!contestMap.has(key)) {
                contestMap.set(key, {
                    id: c._id,
                    title: c.rules?.title || 'Untitled Contest',
                    subtitle: c.rules?.description || '',
                    status,
                    phase: now >= phase3Start ? 3 : (now >= phase2Start ? 2 : 1),
                    myEntries: 0,
                    placement: 'participant',
                    endDate: c.endDate,
                    phase3Start: phase3Start.toISOString(),
                    hasHighlights: now >= phase3Start,
                    submissions: []
                });
            }

            const entry = contestMap.get(key);
            entry.myEntries++;
            entry.submissions.push({
                id: sub._id,
                status: sub.status,
                verdict: sub.verdict,
                thumbnail: sub.fileId?.thumbnailUrl || sub.fileId?.path
            });

            if (
                placement === 'winner' ||
                (placement === 'finalist' && entry.placement === 'participant')
            ) {
                entry.placement = placement;
            }
        }

        res.json({ success: true, contests: Array.from(contestMap.values()) });

    } catch (error) {
        console.error('Get my contests error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PUBLIC WINNERS  (Phase 3 - all authenticated users)
// ============================================

router.get('/:contestId/winners', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const limit = Math.min(Number(req.query.limit) || 10, 30);

        validateObjectId(contestId, 'contestId');

        const result = await getPublicWinners({ contestId, limit });
        res.json({ success: true, ...result });

    } catch (error) {
        console.error('Get winners error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADMIN PREVIEW  (Phase 1 & 2 - Admin/Owner only)
// ============================================

router.get('/:contestId/admin-preview',
    authMiddleware,
    requireAdmin,
    async (req, res) => {
        try {
            const { contestId } = req.params;
            const adminId = req.user.id;

            validateObjectId(contestId, 'contestId');

            const result = await getAdminPreview({ contestId, adminId });
            res.json({ success: true, ...result });

        } catch (error) {
            console.error('Admin preview error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// ============================================
// ADMIN SELECT WINNERS  (Phase 2 only)
// ============================================

router.post('/:contestId/select-winners',
    authMiddleware,
    requireAdmin,
    async (req, res) => {
        try {
            const { contestId } = req.params;
            const { selections } = req.body; // [{ entryId, position, overrideReason }]
            const adminId = req.user.id;

            validateObjectId(contestId, 'contestId');

            //  Guard: contest must exist
            const contest = await Contest.findById(contestId);
            if (!contest) {
                return res.status(404).json({ success: false, error: 'Contest not found' });
            }

            //  Guard: must be Phase 2
            const now = new Date();
            const phase2Start = new Date(contest.endDate);
            phase2Start.setDate(phase2Start.getDate() + 1);
            const phase3Start = new Date(contest.endDate);
            phase3Start.setDate(phase3Start.getDate() + 2);

            if (now < phase2Start || now >= phase3Start) {
                return res.status(403).json({
                    success: false,
                    error: 'Winner selection is only allowed during Phase 2 (+1 day after contest end)'
                });
            }

            //  Guard: selections array must exist and be non-empty
            if (!Array.isArray(selections) || selections.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'selections array is required and must not be empty'
                });
            }

            //  FIX #4: Cap to 30 selections (per spec: picked from top 30)
            if (selections.length > 30) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot select more than 30 winners'
                });
            }

            //  FIX #6: Validate each entryId before processing
            for (const sel of selections) {
                if (!sel.entryId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Each selection must include an entryId'
                    });
                }
                if (!mongoose.Types.ObjectId.isValid(sel.entryId)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid entryId: ${sel.entryId}`
                    });
                }
            }

            // Enrich selections with the winner's userId from Submission
            const enrichedSelections = await Promise.all(
                selections.map(async (sel) => {
                    const entry = await Submission.findById(sel.entryId)
                        .select('userId')
                        .lean();

                    //  FIX #6: Warn if entry not found rather than silently storing undefined
                    if (!entry) {
                        throw new Error(`Submission not found for entryId: ${sel.entryId}`);
                    }

                    return { ...sel, userId: entry.userId };
                })
            );

            const result = await selectWinners({
                contestId,
                selections: enrichedSelections,
                adminId
            });

            // Mark winning / shortlisted submissions
            for (const sel of selections) {
                await Submission.findByIdAndUpdate(sel.entryId, {
                    status: sel.position === 1 ? 'winner' : 'shortlisted'
                });
            }

            res.json({
                success: true,
                message: 'Winners selected successfully',
                ...result
            });

        } catch (error) {
            console.error('Select winners error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// ============================================
// MEDIA EVALUATION  (entry submission)
// ============================================

router.post('/evaluate',
    authMiddleware,
    upload.single('media'),
    handleUploadError,
    async (req, res) => {
        let uploadedFile = null;

        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No media file uploaded' });
            }

            uploadedFile = req.file.path;
            const { contestId, caption } = req.body;
            const userId = req.user.id;

            if (!contestId) {
                return res.status(400).json({ success: false, error: 'contestId is required' });
            }

            const contest = await validateContest(contestId);

            // ============================================
            // FIX: Fetch payment record if entryFee > 0
            // ============================================
            let payment = null;
            if (contest.entryFee > 0) {
                payment = await Payment.findOne({
                    userId,
                    contestId,
                    status: 'verified'
                });

                if (!payment) {
                    return res.status(403).json({
                        success: false,
                        error: 'Payment required before submission'
                    });
                }
            }

            const now = new Date();
            if (now < contest.startDate || now > contest.endDate) {
                return res.status(403).json({
                    success: false,
                    error: 'Contest is not currently active'
                });
            }

            // ============================================
            // CHECK FOR EXISTING ENTRY
            // ============================================

            const existingContestEntry = await ContestEntry.findOne({
                userId,
                contestId
            });

            if (existingContestEntry) {
                if (['pending', 'submitted', 'approved', 'verified'].includes(existingContestEntry.status)) {
                    return res.status(409).json({
                        success: false,
                        error: 'You have already submitted to this contest',
                        existingEntry: {
                            id: existingContestEntry._id,
                            status: existingContestEntry.status,
                            submittedAt: existingContestEntry.createdAt
                        }
                    });
                }
            }

            const existingSubmission = await Submission.findOne({ userId, contestId });
            if (existingSubmission) {
                if (['pending', 'submitted', 'approved', 'verified'].includes(existingSubmission.status)) {
                    return res.status(409).json({
                        success: false,
                        error: 'You have already submitted to this contest',
                        existingSubmission: {
                            id: existingSubmission._id,
                            status: existingSubmission.status
                        }
                    });
                }
            }

            const entryId = new mongoose.Types.ObjectId();

            const contestRules = {
                contestId: contest._id,
                entryId,
                userId,
                theme: contest.rules?.theme || 'General',
                keywords: contest.rules?.keywords || [],
                minEntropy: contest.rules?.minEntropy || 0,
                maxEntropy: contest.rules?.maxEntropy ?? null,
                preferredColor: contest.rules?.preferredColor,
                skinRange: contest.rules?.skinRange,
                allowPeople: contest.rules?.allowPeople,
                requireVertical: contest.rules?.requireVertical,
                maxDurationSeconds: contest.rules?.maxDurationSeconds,
                strictThemeMatch: contest.rules?.strictThemeMatch,
                autoRejectNSFW: contest.rules?.autoRejectNSFW ?? true
            };

            const result = await evaluateMedia(
                req.file.path,
                req.file.mimetype,
                contestRules
            );

            if (result.verdict === 'error') {
                return res.status(400).json({ success: false, error: result.error });
            }

            let cloudFile = null;
            if (result.verdict !== 'rejected') {
                try {
                    cloudFile = await uploadToProvider(req.file);
                    uploadedFile = null;
                } catch (uploadErr) {
                    console.error('Cloudinary upload failed:', uploadErr);
                    return res.status(500).json({ success: false, error: 'Media upload failed' });
                }
            }

            const statusMap = {
                'approved': 'submitted',
                'rejected': 'disqualified',
                'review': 'submitted',
                'error': 'submitted'
            };

            const finalStatus = statusMap[result.verdict] || 'pending';

            // ============================================
            // FIX: Include paymentId in entry data
            // ============================================

            if (result.verdict !== 'error') {

                // Build base entry data
                const contestEntryData = {
                    userId,
                    contestId,
                    status: finalStatus,
                    photos: [],
                    videos: [],
                    submittedAt: new Date(),
                    updatedAt: new Date(),
                    aiScore: result.score,
                    verdict: result.verdict,
                    // FIX: Add paymentId (required field)
                    paymentId: payment?._id || null,
                    metadata: {
                        ...result.metadata,
                        caption: caption || '',
                        mediaUrl: cloudFile?.url || null,
                        thumbnailUrl: cloudFile?.thumbnailUrl || null,
                        cloudinaryPublicId: cloudFile?.publicId || null,
                        mediaType: result.mediaType,
                        entryId: entryId
                    }
                };

                // Add file reference based on type
                if (result.mediaType === 'image') {
                    contestEntryData.photos.push(entryId);
                } else {
                    contestEntryData.videos.push(entryId);
                }

                let savedEntry;
                if (existingContestEntry) {
                    // Update existing entry - keep existing paymentId if present
                    contestEntryData.paymentId = existingContestEntry.paymentId || payment?._id || null;
                    savedEntry = await ContestEntry.findByIdAndUpdate(
                        existingContestEntry._id,
                        { $set: contestEntryData },
                        { new: true }
                    );
                } else {
                    savedEntry = await ContestEntry.create(contestEntryData);
                }

                // Also create Submission record
                await Submission.findOneAndUpdate(
                    { userId, contestId },
                    {
                        $set: {
                            contestId,
                            userId,
                            fileId: entryId,
                            caption: caption || '',
                            mediaUrl: cloudFile?.url || null,
                            thumbnailUrl: cloudFile?.thumbnailUrl || null,
                            cloudinaryPublicId: cloudFile?.publicId || null,
                            mediaType: result.mediaType,
                            status: finalStatus,
                            verdict: result.verdict,
                            aiScore: result.score,
                            metadata: result.metadata,
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true, new: true }
                );
            }

            res.json({
                success: result.success,
                ...result,
                mediaUrl: cloudFile?.url || null,
                entryId: entryId
            });

        } catch (error) {
            console.error('Evaluation error:', error);

            const statusCode =
                error.message.includes('not configured') ||
                    error.message.includes('Invalid')
                    ? 400
                    : 500;

            res.status(statusCode).json({
                success: false,
                error: error.message
            });

        } finally {
            if (uploadedFile) {
                try { await fs.unlink(uploadedFile); } catch (_) { }
            }
        }
    }
);

// ============================================
// APPEAL SUBMISSION
// ============================================

router.post('/appeals', authMiddleware, async (req, res) => {
    try {
        const { contestId, entryId, appealReason, explanation } = req.body;

        if (!contestId || !entryId || !appealReason) {
            return res.status(400).json({
                success: false,
                error: 'contestId, entryId, and appealReason are required'
            });
        }

        validateObjectId(contestId, 'contestId');
        validateObjectId(entryId, 'entryId');

        if (appealReason.length < 10 || appealReason.length > 1000) {
            return res.status(400).json({
                success: false,
                error: 'Appeal reason must be between 10 and 1000 characters'
            });
        }

        const existingAppeal = await ContestAppeal.findOne({ entryId, userId: req.user.id });
        if (existingAppeal) {
            return res.status(400).json({
                success: false,
                error: 'An appeal for this entry already exists',
                existingAppeal: { status: existingAppeal.status, createdAt: existingAppeal.createdAt }
            });
        }

        const appeal = await ContestAppeal.create({
            contestId,
            entryId,
            userId: req.user.id,
            originalVerdict: explanation?.verdict || 'rejected',
            appealReason,
            aiExplanationSnapshot: explanation || {}
        });

        res.json({
            success: true,
            message: 'Appeal submitted successfully',
            appeal: { id: appeal._id, status: appeal.status, createdAt: appeal.createdAt }
        });

    } catch (error) {
        console.error('Appeal submission error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ success: false, error: 'An appeal for this entry already exists' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// APPEAL REVIEW  (Admin only)
// ============================================

router.post('/admin/appeals/:appealId/review',
    authMiddleware,
    requireAdmin,
    async (req, res) => {
        try {
            const { appealId } = req.params;
            const { status, reviewerNotes } = req.body;

            validateObjectId(appealId, 'appealId');

            if (!status || !['accepted', 'rejected'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'status must be either "accepted" or "rejected"'
                });
            }

            const appeal = await ContestAppeal.findById(appealId);
            if (!appeal) {
                return res.status(404).json({ success: false, error: 'Appeal not found' });
            }

            if (appeal.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    error: `Appeal already ${appeal.status}`,
                    appeal: { status: appeal.status, reviewedBy: appeal.reviewedBy, reviewerNotes: appeal.reviewerNotes }
                });
            }

            appeal.status = status;
            appeal.reviewerNotes = reviewerNotes || '';
            appeal.reviewedBy = req.user.id;
            await appeal.save();

            res.json({
                success: true,
                message: `Appeal ${status}`,
                appeal: {
                    id: appeal._id,
                    status: appeal.status,
                    reviewedBy: appeal.reviewedBy,
                    reviewerNotes: appeal.reviewerNotes,
                    updatedAt: appeal.updatedAt
                }
            });

        } catch (error) {
            console.error('Appeal review error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', (req, res) => {
    const CONFIG = require('../config');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: CONFIG.nodeEnv,
        features: {
            phase2Enabled: CONFIG.enablePhase2,
            hasHFToken: !!CONFIG.huggingFaceToken,
            supportedFormats: CONFIG.supportedFormats
        }
    });
});

module.exports = router;