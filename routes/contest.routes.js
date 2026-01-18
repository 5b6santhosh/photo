// ============================================
// CONTEST API ROUTES - CORRECTED VERSION
// ============================================

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { upload, handleUploadError } = require('../middleware/upload');
const { authMiddleware, requireAdmin, requireJudge } = require('../middleware/auth');
const { evaluateMedia } = require('../services/mediaEvaluation.service');
const { getTopRankedEntries } = require('../services/contestRanking.service');
const Contest = require('../models/Contest');
const ContestAppeal = require('../models/ContestAppeal');
const JudgeDecision = require('../models/JudgeDecision');
const fs = require('fs').promises;

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

    const contest = await Contest.findById(contestId).populate('rules');

    if (!contest) {
        throw new Error('Contest not found');
    }

    if (!contest.rules) {
        throw new Error('Contest rules not configured');
    }

    return contest;
}

// ============================================
// MEDIA EVALUATION ENDPOINT
// ============================================

router.post('/evaluate',
    authMiddleware,
    upload.single('media'),
    handleUploadError,
    async (req, res) => {
        let uploadedFile = null;

        try {
            // Validate file upload
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No media file uploaded'
                });
            }

            uploadedFile = req.file.path;

            // Validate request body
            const { contestId, entryId } = req.body;

            if (!contestId) {
                return res.status(400).json({
                    success: false,
                    error: 'contestId is required'
                });
            }

            // Validate and load contest
            const contest = await validateContest(contestId);

            // Build contest rules object
            const contestRules = {
                contestId: contest._id,
                entryId: entryId || new mongoose.Types.ObjectId(),
                userId: req.user.id,
                theme: contest.rules.theme,
                keywords: contest.rules.keywords,
                minEntropy: contest.rules.minEntropy,
                maxEntropy: contest.rules.maxEntropy,
                preferredColor: contest.rules.preferredColor,
                skinRange: contest.rules.skinRange,
                allowPeople: contest.rules.allowPeople,
                requireVertical: contest.rules.requireVertical,
                maxDurationSeconds: contest.rules.maxDurationSeconds,
                strictThemeMatch: contest.rules.strictThemeMatch,
                autoRejectNSFW: contest.rules.autoRejectNSFW
            };

            // Run evaluation
            console.log(`📊 Evaluating media for contest ${contestId}...`);
            const result = await evaluateMedia(
                req.file.path,
                req.file.mimetype,
                contestRules
            );

            // Return result
            res.json({
                success: result.success,
                ...result
            });

        } catch (error) {
            console.error('Evaluation endpoint error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Evaluation failed'
            });
        } finally {
            // Cleanup uploaded file
            if (uploadedFile) {
                try {
                    await fs.access(uploadedFile);
                    await fs.unlink(uploadedFile);
                } catch (err) {
                    // File already deleted or doesn't exist
                }
            }
        }
    }
);

// ============================================
// CONTEST WINNERS ENDPOINT
// ============================================

router.get('/contests/:contestId/winners',
    authMiddleware,
    async (req, res) => {
        try {
            const { contestId } = req.params;
            validateObjectId(contestId, 'contestId');

            const limit = Math.min(Number(req.query.limit) || 3, 20); // Max 20

            // 1. Check for judge-selected winners first
            const judgeWinners = await JudgeDecision.find({
                contestId,
                finalDecision: 'winner'
            })
                .populate('entryId', 'title mediaUrl userId')
                .populate('userId', 'name email')
                .limit(limit)
                .lean();

            if (judgeWinners.length > 0) {
                return res.json({
                    success: true,
                    winners: judgeWinners.map((w, idx) => ({
                        rank: idx + 1,
                        entryId: w.entryId,
                        userId: w.userId,
                        aiScore: w.aiScore,
                        aiRank: w.aiRank,
                        decision: w.finalDecision,
                        overrideReason: w.overrideReason
                    })),
                    source: 'judge',
                    count: judgeWinners.length
                });
            }

            // 2. Fallback to AI-ranked winners
            const aiWinners = await getTopRankedEntries({
                contestId,
                limit
            });

            res.json({
                success: true,
                winners: aiWinners,
                source: 'ai',
                count: aiWinners.length
            });

        } catch (error) {
            console.error('Get winners error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ============================================
// APPEAL SUBMISSION ENDPOINT
// ============================================

router.post('/appeals',
    authMiddleware,
    async (req, res) => {
        try {
            const { contestId, entryId, appealReason, explanation } = req.body;

            // Validation
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

            // Check if appeal already exists
            const existingAppeal = await ContestAppeal.findOne({
                entryId,
                userId: req.user.id
            });

            if (existingAppeal) {
                return res.status(400).json({
                    success: false,
                    error: 'An appeal for this entry already exists',
                    existingAppeal: {
                        status: existingAppeal.status,
                        createdAt: existingAppeal.createdAt
                    }
                });
            }

            // Create appeal
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
                appeal: {
                    id: appeal._id,
                    status: appeal.status,
                    createdAt: appeal.createdAt
                }
            });

        } catch (error) {
            console.error('Appeal submission error:', error);

            if (error.code === 11000) { // Duplicate key error
                return res.status(400).json({
                    success: false,
                    error: 'An appeal for this entry already exists'
                });
            }

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ============================================
// APPEAL REVIEW ENDPOINT (ADMIN ONLY)
// ============================================

router.post('/admin/appeals/:appealId/review',
    authMiddleware,
    requireAdmin,
    async (req, res) => {
        try {
            const { appealId } = req.params;
            const { status, reviewerNotes } = req.body;

            validateObjectId(appealId, 'appealId');

            // Validation
            if (!status || !['accepted', 'rejected'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'status must be either "accepted" or "rejected"'
                });
            }

            // Find appeal
            const appeal = await ContestAppeal.findById(appealId);

            if (!appeal) {
                return res.status(404).json({
                    success: false,
                    error: 'Appeal not found'
                });
            }

            if (appeal.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    error: `Appeal already ${appeal.status}`,
                    appeal: {
                        status: appeal.status,
                        reviewedBy: appeal.reviewedBy,
                        reviewerNotes: appeal.reviewerNotes
                    }
                });
            }

            // Update appeal
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
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// ============================================
// HEALTH CHECK ENDPOINT
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