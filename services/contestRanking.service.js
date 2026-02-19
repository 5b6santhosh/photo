// ============================================
// CONTEST RANKING SERVICE - COMPLETE VERSION
// ============================================

const mongoose = require('mongoose');
const MLFeatureLog = require('../models/MLFeatureLog');
const Like = require('../models/Like');
const Contest = require('../models/Contest');
const JudgeDecision = require('../models/JudgeDecision');

function getPhaseInfo(contest) {
    const now = new Date();
    const contestEnd = new Date(contest.endDate);
    const phase2Start = new Date(contestEnd);
    phase2Start.setDate(phase2Start.getDate() + 1);
    const phase3Start = new Date(contestEnd);
    phase3Start.setDate(phase3Start.getDate() + 2);

    let phase = 1;
    if (now >= phase3Start) phase = 3;
    else if (now >= phase2Start) phase = 2;

    return { phase, contestEnd, phase2Start, phase3Start };
}

// ============================================
// COMPLETE SCORING ALGORITHM
// ============================================

async function getTopEntriesForReview({ contestId, limit = 30 }) {
    const contest = await Contest.findById(contestId).populate('rules');
    if (!contest) throw new Error('Contest not found');

    // Get all entries with full AI data
    const entries = await MLFeatureLog.find({
        contestId,
        verdict: { $in: ['approved', 'review'] }
    }).lean();

    if (entries.length === 0) return [];

    // Get likes
    const entryObjectIds = entries.map(e => new mongoose.Types.ObjectId(e.entryId.toString()));
    const likeAgg = await Like.aggregate([
        { $match: { entryId: { $in: entryObjectIds } } },
        { $group: { _id: '$entryId', count: { $sum: 1 } } }
    ]);
    const likeCounts = likeAgg.reduce((acc, curr) => {
        acc[curr._id.toString()] = curr.count;
        return acc;
    }, {});
    const maxLikes = Math.max(...Object.values(likeCounts), 1);

    // Get contest rules for weighting
    const rules = contest.rules || {};

    const ranked = entries.map(entry => {
        // ============== PHASE 1 SCORES ==============
        const p1Quality = entry.scores?.quality ?? 0;   // 0-40
        const p1Theme = entry.scores?.theme ?? 0;       // 0-30  
        const p1Safety = Math.max(0, entry.scores?.safety ?? 0); // 0-30

        // ============== PHASE 2 AI SIGNALS ==============
        const ai = entry.aiSignals || {};
        const nsfwScore = ai.nsfwScore ?? 0;                    // 0-1 (higher = bad)
        const themeSimilarity = ai.themeSimilarity ?? 0;        // 0-1 (higher = good)
        const perceptualQuality = ai.perceptualQuality ?? 50;   // 0-100

        // ============== RAW FEATURES ==============
        const features = entry.features || {};
        const sharpness = features.sharpness ?? 0;
        const entropy = features.entropy ?? 0;
        const brightness = features.brightness ?? 128;

        // ============== SOCIAL ==============
        const likes = likeCounts[entry.entryId.toString()] || 0;
        const socialScore = (likes / maxLikes) * 100;

        // ============== CALCULATE COMPONENT SCORES ==============

        // 1. TECHNICAL QUALITY (0-100)
        // Combine Phase 1 quality + Phase 2 perceptual + sharpness
        let technicalScore = (
            (p1Quality / 40) * 50 +           // Phase 1 quality (normalized to 50 pts)
            (perceptualQuality / 100) * 30 +   // AI perceptual quality (30 pts)
            Math.min(sharpness, 100) / 100 * 20 // Sharpness (20 pts)
        );

        // Apply contest rule: minEntropy requirement
        if (rules.minEntropy && entropy < rules.minEntropy) {
            technicalScore *= 0.8; // 20% penalty for low entropy
        }
        if (rules.maxEntropy && entropy > rules.maxEntropy) {
            technicalScore *= 0.8; // 20% penalty for high entropy
        }

        // 2. THEME RELEVANCE (0-100)
        // Combine Phase 1 theme + Phase 2 CLIP similarity
        let themeScore = (
            (p1Theme / 30) * 60 +              // Phase 1 theme (60% weight)
            themeSimilarity * 40                // AI CLIP similarity (40% weight, 0-1 * 40)
        );

        // Boost if AI confirms theme match strongly
        if (themeSimilarity > 0.7) {
            themeScore = Math.min(100, themeScore * 1.15); // 15% bonus
        }

        // Strict theme match requirement
        if (rules.strictThemeMatch && themeSimilarity < 0.4) {
            themeScore *= 0.5; // Heavy penalty
        }

        // 3. SAFETY SCORE (0-100, inverted)
        // NSFW detection from Phase 2
        let safetyScore = 100 - (nsfwScore * 100); // Convert 0-1 to 100-0

        // Blend with Phase 1 safety
        safetyScore = (safetyScore * 0.7) + ((p1Safety / 30) * 100 * 0.3);

        // Auto-reject if NSFW threshold breached
        const isNSFW = nsfwScore > (CONFIG.nsfwThreshold || 0.7);
        if (isNSFW || entry.verdict === 'rejected') {
            safetyScore = -1000; // Disqualify
        }

        // 4. ENGAGEMENT (0-100)
        const engagementScore = socialScore;

        // ============== FINAL WEIGHTED SCORE ==============
        // Weights: Technical 35%, Theme 30%, Safety 20%, Engagement 15%
        let finalScore = (
            technicalScore * 0.35 +
            themeScore * 0.30 +
            Math.max(0, safetyScore) * 0.20 + // Don't let safety go negative in weighting
            engagementScore * 0.15
        );

        // ============== CONTEST RULE OVERRIDES ==============

        // Skin exposure rule check
        const skinRatio = features.skinExposureRatio ?? 0;
        if (rules.skinRange && Array.isArray(rules.skinRange)) {
            const [minSkin, maxSkin] = rules.skinRange;
            if (skinRatio < minSkin || skinRatio > maxSkin) {
                finalScore *= 0.9; // 10% penalty
            }
        }

        // Vertical requirement for videos
        if (rules.requireVertical && entry.mediaType === 'video') {
            const aspectRatio = (features.width / features.height) || 1;
            if (aspectRatio > 0.7) { // Not vertical enough
                finalScore *= 0.85; // 15% penalty
            }
        }

        // Color preference
        if (rules.preferredColor === 'green' && features.colorDominance) {
            if (features.colorDominance.green < 0.3) {
                finalScore *= 0.95;
            }
        }

        // ============== DISQUALIFICATION CHECKS ==============
        let disqualified = false;
        let disqualifyReason = null;

        if (isNSFW) {
            disqualified = true;
            disqualifyReason = 'NSFW content detected by AI';
        } else if (entry.verdict === 'rejected') {
            disqualified = true;
            disqualifyReason = 'Failed initial evaluation';
        } else if (features.perceptualHash && entry.duplicateOf) {
            disqualified = true;
            disqualifyReason = 'Duplicate submission';
        }

        return {
            entryId: entry.entryId,
            userId: entry.userId,
            contestId: entry.contestId,

            // Component scores for transparency
            scores: {
                technical: Math.round(technicalScore),
                theme: Math.round(themeScore),
                safety: Math.round(safetyScore),
                engagement: Math.round(engagementScore),
                final: Math.round(finalScore)
            },

            // Raw data for admin review
            details: {
                phase1: { quality: p1Quality, theme: p1Theme, safety: p1Safety },
                aiSignals: { nsfwScore, themeSimilarity, perceptualQuality },
                features: { sharpness, entropy, skinRatio },
                likes,
                disqualified,
                disqualifyReason
            },

            mediaType: entry.mediaType
        };
    });

    // Filter out disqualified entries first
    const qualified = ranked.filter(r => !r.details.disqualified);
    const disqualified = ranked.filter(r => r.details.disqualified);

    // Sort by final score descending
    qualified.sort((a, b) => b.scores.final - a.scores.final);

    // Add preliminary ranks
    const topEntries = qualified.slice(0, limit).map((e, index) => ({
        ...e,
        preliminaryRank: index + 1
    }));

    // Return both qualified top 30 and disqualified list (for admin transparency)
    return {
        qualified: topEntries,
        disqualified: disqualified.slice(0, 10), // Show top 10 disqualified
        stats: {
            totalEntries: entries.length,
            qualifiedCount: qualified.length,
            disqualifiedCount: disqualified.length
        }
    };
}

// ============================================
// ADMIN PREVIEW WITH FULL DETAILS
// ============================================

async function getAdminPreview({ contestId, adminId }) {
    const contest = await Contest.findById(contestId);
    if (!contest) throw new Error('Contest not found');

    const { phase, phase3Start } = getPhaseInfo(contest);

    if (phase === 3) {
        return {
            phase: 3,
            canSelect: false,
            message: 'Results are now public. Use /winners endpoint.',
            topEntries: []
        };
    }

    // Get full ranking with all AI details
    const rankingResult = await getTopEntriesForReview({ contestId, limit: 30 });

    // Get existing judge decisions
    const existingDecisions = await JudgeDecision.find({ contestId }).lean();
    const decisionMap = existingDecisions.reduce((acc, d) => {
        acc[d.entryId.toString()] = d;
        return acc;
    }, {});

    // Populate entry media info
    const Submission = require('../models/Submission');
    const populatedEntries = await Promise.all(
        rankingResult.qualified.map(async (entry) => {
            const sub = await Submission.findById(entry.entryId)
                .populate('fileId', 'thumbnailUrl path title')
                .populate('userId', 'name email avatarUrl')
                .lean();

            return {
                ...entry,
                media: sub?.fileId || null,
                user: sub?.userId || null,
                isSelected: !!decisionMap[entry.entryId.toString()],
                selectionDetails: decisionMap[entry.entryId.toString()] || null
            };
        })
    );

    return {
        phase,
        canSelect: phase === 2,
        revealAt: phase3Start.toISOString(),
        stats: rankingResult.stats,
        topEntries: populatedEntries,
        disqualified: rankingResult.disqualified
    };
}

// ============================================
// PUBLIC WINNERS (Phase 3)
// ============================================

async function getPublicWinners({ contestId, limit = 10 }) {
    const contest = await Contest.findById(contestId);
    if (!contest) throw new Error('Contest not found');

    const { phase, phase3Start } = getPhaseInfo(contest);

    if (phase < 3) {
        return {
            phase,
            visible: false,
            revealAt: phase3Start.toISOString(),
            message: phase === 1
                ? 'Contest ended. Admin reviewing entries...'
                : 'Final winner selection in progress...',
            winners: []
        };
    }

    // Get judge selections first
    const judgeWinners = await JudgeDecision.find({
        contestId,
        finalDecision: 'winner'
    })
        .populate('entryId', 'title mediaUrl thumbnailUrl')
        .populate('userId', 'name email avatarUrl')
        .sort({ position: 1 })
        .limit(limit)
        .lean();

    if (judgeWinners.length > 0) {
        return {
            phase: 3,
            visible: true,
            source: 'judge',
            winners: judgeWinners.map(w => ({
                rank: w.position,
                entryId: w.entryId,
                userId: w.userId,
                aiScore: w.aiScore,
                aiRank: w.aiRank,
                overrideReason: w.overrideReason
            }))
        };
    }

    // Fallback to AI ranking if no judge picks
    const rankingResult = await getTopEntriesForReview({ contestId, limit });

    return {
        phase: 3,
        visible: true,
        source: 'ai_fallback',
        winners: rankingResult.qualified.map((w, idx) => ({
            rank: idx + 1,
            entryId: w.entryId,
            userId: w.userId,
            scores: w.scores,
            details: {
                likes: w.details.likes,
                themeSimilarity: w.details.aiSignals.themeSimilarity
            }
        }))
    };
}

// ============================================
// SELECT WINNERS (Phase 2)
// ============================================

async function selectWinners({ contestId, selections, adminId }) {
    await JudgeDecision.deleteMany({ contestId });

    const decisions = selections.map((sel, idx) => ({
        contestId,
        entryId: sel.entryId,
        userId: sel.userId,
        judgeId: adminId,
        aiScore: sel.scores?.final || sel.aiScore,
        aiRank: sel.preliminaryRank,
        finalDecision: 'winner',
        position: sel.position || idx + 1,
        overrideReason: sel.overrideReason || null,
        selectedAt: new Date()
    }));

    await JudgeDecision.insertMany(decisions);
    return { success: true, count: decisions.length };
}

module.exports = {
    getTopEntriesForReview,
    getAdminPreview,
    getPublicWinners,
    selectWinners
};