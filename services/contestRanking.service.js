// ============================================
// CONTEST RANKING SERVICE — FIXED COMPLETE VERSION
// ============================================

const mongoose = require('mongoose');
const MLFeatureLog = require('../models/MLFeatureLog');
const Like = require('../models/Like');
const Contest = require('../models/Contest');
const JudgeDecision = require('../models/JudgeDecision');

// ============================================
// PHASE DETECTION
// Phase 1 : contest is active (submissions open)
// Phase 2 : endDate +1 day  → admin reviews & picks winners
// Phase 3 : endDate +2 days → results are public
// ============================================

function getPhaseInfo(contest) {
    const now = new Date();
    const contestEnd = new Date(contest.endDate);

    const phase2Start = new Date(contestEnd);
    phase2Start.setDate(phase2Start.getDate() + 1);   // endDate + 1 day

    const phase3Start = new Date(contestEnd);
    phase3Start.setDate(phase3Start.getDate() + 2);   // endDate + 2 days

    let phase = 1;
    if (now >= phase3Start) phase = 3;
    else if (now >= phase2Start) phase = 2;

    return { phase, contestEnd, phase2Start, phase3Start };
}

// ============================================
// CORE RANKING — fetches top N entries by score
// ============================================

async function getTopEntriesForReview({ contestId, limit = 30 }) {
    const contest = await Contest.findById(contestId).populate('rules');
    if (!contest) throw new Error('Contest not found');

    // ── PRIMARY: MLFeatureLog (written by /evaluate) ──────────────────────
    // BUG FIX #4 was here: was `const` → must be `let` for fallback reassignment
    let entries = await MLFeatureLog.find({
        contestId,
        verdict: { $in: ['approved', 'review'] }
    }).lean();

    // ── FALLBACK: Submission records ──────────────────────────────────────
    if (entries.length === 0) {
        console.log('⚠️ MLFeatureLog empty — falling back to Submission records');

        const Submission = require('../models/Submission');
        const submissions = await Submission.find({
            contestId,
            status: { $in: ['submitted', 'approved', 'shortlisted', 'winner', 'pending'] }
        }).lean();

        if (submissions.length === 0) {
            return {
                qualified: [],
                disqualified: [],
                stats: { totalEntries: 0, qualifiedCount: 0, disqualifiedCount: 0 }
            };
        }

        // Build synthetic MLFeatureLog-shaped objects from Submission records.
        // BUG FIX #2: use sub._id as entryId so getAdminPreview can
        // call Submission.findById(_submissionId) and get the real record.
        entries = submissions.map(sub => ({
            entryId: sub._id,
            userId: sub.userId,
            contestId: sub.contestId,
            verdict: sub.verdict || 'approved',
            scores: {
                quality: sub.aiScore ? sub.aiScore * 0.4 : 20,
                theme: sub.aiScore ? sub.aiScore * 0.3 : 15,
                safety: sub.aiScore ? sub.aiScore * 0.3 : 15,
            },
            aiSignals: {
                nsfwScore: 0,
                themeSimilarity: 0.5,
                perceptualQuality: sub.aiScore || 50,
            },
            features: {
                sharpness: 50,
                entropy: 5,
                brightness: 128,
                skinExposureRatio: 0,
            },
            mediaType: sub.mediaType || 'image',
            _isSyntheticFallback: true,
            _submissionId: sub._id,   // used by getAdminPreview to populate media/user
        }));
    }

    // ── LIKES aggregation ─────────────────────────────────────────────────
    const entryObjectIds = entries.map(
        e => new mongoose.Types.ObjectId(e.entryId.toString())
    );

    const likeAgg = await Like.aggregate([
        { $match: { entryId: { $in: entryObjectIds } } },
        { $group: { _id: '$entryId', count: { $sum: 1 } } }
    ]);

    const likeCounts = likeAgg.reduce((acc, curr) => {
        acc[curr._id.toString()] = curr.count;
        return acc;
    }, {});

    const maxLikes = Math.max(...Object.values(likeCounts), 1);

    const rules = contest.rules || {};

    // BUG FIX #5: CONFIG.nsfwThreshold was undefined here → use plain constant
    const NSFW_THRESHOLD = 0.7;

    // ── SCORE each entry ──────────────────────────────────────────────────
    const ranked = entries.map(entry => {

        // Phase-1 component scores
        const p1Quality = entry.scores?.quality ?? 0;   // 0–40
        const p1Theme = entry.scores?.theme ?? 0;   // 0–30
        const p1Safety = Math.max(0, entry.scores?.safety ?? 0); // 0–30

        // Phase-2 AI signals
        const ai = entry.aiSignals || {};
        const nsfwScore = ai.nsfwScore ?? 0;
        const themeSimilarity = ai.themeSimilarity ?? 0;
        const perceptualQuality = ai.perceptualQuality ?? 50;

        // Raw image features
        const features = entry.features || {};
        const sharpness = features.sharpness ?? 0;
        const entropy = features.entropy ?? 0;
        const skinRatio = features.skinExposureRatio ?? 0;

        // Social score
        const likes = likeCounts[entry.entryId.toString()] || 0;
        const socialScore = (likes / maxLikes) * 100;

        // ── 1. Technical quality (0–100) ───────────────────────────────
        let technicalScore =
            (p1Quality / 40) * 50 +
            (perceptualQuality / 100) * 30 +
            (Math.min(sharpness, 100) / 100) * 20;

        if (rules.minEntropy && entropy < rules.minEntropy) technicalScore *= 0.8;
        if (rules.maxEntropy && entropy > rules.maxEntropy) technicalScore *= 0.8;

        // ── 2. Theme relevance (0–100) ─────────────────────────────────
        let themeScore =
            (p1Theme / 30) * 60 +
            themeSimilarity * 40;

        if (themeSimilarity > 0.7) themeScore = Math.min(100, themeScore * 1.15);
        if (rules.strictThemeMatch && themeSimilarity < 0.4) themeScore *= 0.5;

        // ── 3. Safety score (0–100, inverted from NSFW) ────────────────
        let safetyScore = 100 - (nsfwScore * 100);
        safetyScore = (safetyScore * 0.7) + ((p1Safety / 30) * 100 * 0.3);

        const isNSFW = nsfwScore > NSFW_THRESHOLD;
        if (isNSFW || entry.verdict === 'rejected') safetyScore = -1000; // disqualify

        // ── 4. Engagement (0–100) ──────────────────────────────────────
        const engagementScore = socialScore;

        // ── Final weighted score ───────────────────────────────────────
        // Technical 35% | Theme 30% | Safety 20% | Engagement 15%
        let finalScore =
            technicalScore * 0.35 +
            themeScore * 0.30 +
            Math.max(0, safetyScore) * 0.20 +
            engagementScore * 0.15;

        // Contest rule penalties
        if (rules.skinRange && Array.isArray(rules.skinRange)) {
            const [minSkin, maxSkin] = rules.skinRange;
            if (skinRatio < minSkin || skinRatio > maxSkin) finalScore *= 0.9;
        }

        if (rules.requireVertical && entry.mediaType === 'video') {
            const aspectRatio = (features.width / features.height) || 1;
            if (aspectRatio > 0.7) finalScore *= 0.85;
        }

        // ── Disqualification ───────────────────────────────────────────
        let disqualified = false;
        let disqualifyReason = null;

        if (isNSFW) {
            disqualified = true;
            disqualifyReason = 'NSFW content detected';
        } else if (entry.verdict === 'rejected') {
            disqualified = true;
            disqualifyReason = 'Failed initial evaluation';
        } else if (entry.duplicateOf) {
            disqualified = true;
            disqualifyReason = 'Duplicate submission';
        }

        return {
            entryId: entry.entryId,
            userId: entry.userId,
            contestId: entry.contestId,
            _submissionId: entry._submissionId || entry.entryId, // for population in getAdminPreview
            scores: {
                technical: Math.round(technicalScore),
                theme: Math.round(themeScore),
                safety: Math.round(safetyScore),
                engagement: Math.round(engagementScore),
                final: Math.round(finalScore)
            },
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

    // Separate qualified vs disqualified, sort by final score
    const qualified = ranked.filter(r => !r.details.disqualified);
    const disqualified = ranked.filter(r => r.details.disqualified);
    qualified.sort((a, b) => b.scores.final - a.scores.final);

    const topEntries = qualified.slice(0, limit).map((e, index) => ({
        ...e,
        preliminaryRank: index + 1
    }));

    return {
        qualified: topEntries,
        disqualified: disqualified.slice(0, 10),
        stats: {
            totalEntries: entries.length,
            qualifiedCount: qualified.length,
            disqualifiedCount: disqualified.length
        }
    };
}

// ============================================
// ADMIN PREVIEW  (Phase 1 & 2)
// Returns ranked leaderboard with media + user info.
// BUG FIX #3: phase === 3 guard now has a dev bypass flag.
// BUG FIX #6: Submission is now found by _submissionId (its own _id).
// ============================================

async function getAdminPreview({ contestId, adminId }) {
    const contest = await Contest.findById(contestId);
    if (!contest) throw new Error('Contest not found');

    const { phase, phase3Start } = getPhaseInfo(contest);

    // ── PHASE 3 GUARD ─────────────────────────────────────────────────────
    // In production: once phase 3 starts, winners are public — use /winners.
    // For local testing: set NODE_ENV=development to bypass this guard and
    // always see the preview regardless of how old the contest endDate is.
    const isDev = process.env.NODE_ENV !== 'production';

    if (phase === 3 && !isDev) {
        return {
            phase: 3,
            canSelect: false,
            message: 'Results are now public. Use /winners endpoint.',
            topEntries: [],
            leaderboard: []
        };
    }

    // ── RANK entries ──────────────────────────────────────────────────────
    const rankingResult = await getTopEntriesForReview({ contestId, limit: 30 });

    // ── Existing judge decisions ──────────────────────────────────────────
    const existingDecisions = await JudgeDecision.find({ contestId }).lean();
    const decisionMap = existingDecisions.reduce((acc, d) => {
        acc[d.entryId.toString()] = d;
        return acc;
    }, {});

    const Submission = require('../models/Submission');

    // ── Populate media & user for each ranked entry ───────────────────────
    // BUG FIX #6: original code used a $or with `metadata.entryId` which
    // doesn't exist on the Submission schema → always returned null.
    // Now we simply findById(_submissionId) which is the Submission's own _id.
    const populatedEntries = await Promise.all(
        rankingResult.qualified.map(async (entry) => {

            const submissionId = entry._submissionId || entry.entryId;

            const sub = await Submission.findById(submissionId)
                .populate('fileId', 'thumbnailUrl path title')
                .populate('userId', 'name email avatarUrl')
                .lean();

            // Shape the response to match your Flutter Leaderboard model
            return {
                rank: entry.preliminaryRank,
                entryId: {
                    id: entry.entryId.toString(),
                    thumbnailUrl: sub?.fileId?.thumbnailUrl ?? sub?.thumbnailUrl ?? null,
                    mediaUrl: sub?.fileId?.path ?? sub?.mediaUrl ?? null,
                },
                user: sub?.userId
                    ? {
                        name: sub.userId.name ?? sub.userId.email ?? 'Unknown',
                        avatarUrl: sub.userId.avatarUrl ?? null,
                    }
                    : null,
                scores: {
                    aiFinal: entry.scores.final,
                    themeMatch: entry.scores.theme,
                    technicalQuality: entry.scores.technical,
                    engagement: entry.scores.engagement,
                },
                judgeStatus: sub?.status ?? 'pending',
                isSelected: !!decisionMap[entry.entryId.toString()],
                selectionDetails: decisionMap[entry.entryId.toString()] ?? null,
            };
        })
    );

    return {
        phase,
        canSelect: phase === 2,
        revealAt: phase3Start.toISOString(),
        stats: rankingResult.stats,
        topEntries: populatedEntries,  // kept for backward-compat
        leaderboard: populatedEntries,  // Flutter reads `leaderboard`
        isFinalized: contest.settlement?.finalized ?? false,
        disqualified: rankingResult.disqualified
    };
}

// ============================================
// PUBLIC WINNERS  (Phase 3)
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

    // Prefer judge-selected winners
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

    // Fallback: AI ranking
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
// SELECT WINNERS  (Phase 2 — admin action)
// ============================================

async function selectWinners({ contestId, selections, adminId }) {
    // Clear any previous selections for this contest
    await JudgeDecision.deleteMany({ contestId });

    const decisions = selections.map((sel, idx) => ({
        contestId,
        entryId: sel.entryId,
        userId: sel.userId,
        judgeId: adminId,
        aiScore: sel.scores?.final ?? sel.aiScore ?? null,
        aiRank: sel.preliminaryRank ?? null,
        finalDecision: 'winner',
        position: sel.position || idx + 1,
        overrideReason: sel.overrideReason ?? null,
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