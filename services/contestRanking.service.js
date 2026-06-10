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

// ============================================
// PHASE DETECTION - UPDATED FOR 3-DAY WINDOW
// Phase 1 : contest is active (startDate to endDate inclusive)
// Phase 2 : endDate < now <= endDate + 3 days → admin selects winners
// Phase 3 : now > endDate + 3 days → results are public
// ============================================

function getPhaseInfo(contest) {
    const now = new Date();
    const contestEnd = new Date(contest.endDate);

    // Reset time to midnight for consistent date comparison
    contestEnd.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    // 🔧 FIXED: Phase 2 starts IMMEDIATELY after contest ends (endDate + 0 days)
    const phase2Start = new Date(contestEnd);
    phase2Start.setDate(phase2Start.getDate() + 0);  // Same day as endDate

    // 🔧 FIXED: Phase 2 lasts for 3 FULL days after contest ends
    const phase3Start = new Date(contestEnd);
    phase3Start.setDate(phase3Start.getDate() + 3);  // endDate + 3 days

    let phase = 1;
    if (now > contestEnd) {
        if (now < phase3Start) {
            phase = 2;  // Winner selection window (3 days)
        } else {
            phase = 3;  // Results public
        }
    }
    // else phase = 1 (contest still active)

    return {
        phase,
        contestEnd,
        phase2Start,
        phase3Start,
        daysRemainingForSelection: phase === 2
            ? Math.ceil((phase3Start - now) / (1000 * 60 * 60 * 24))
            : 0
    };
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

    const { phase, phase3Start, daysRemainingForSelection } = getPhaseInfo(contest);

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
            selectionWindowClosed: true,
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
            let sub = null;
            const submissionId = entry._submissionId || entry.entryId;

            // 🔧 FIX #1: Try finding Submission by _submissionId first
            if (submissionId && mongoose.Types.ObjectId.isValid(submissionId)) {
                sub = await Submission.findById(submissionId)
                    .populate('fileId', 'thumbnailUrl path title')
                    .populate('userId', 'name firstName email avatarUrl')
                    .lean();
            }

            // 🔧 FIX #2: Fallback - find by userId + contestId (for MLFeatureLog entries)
            if (!sub && entry.userId && entry.contestId) {
                sub = await Submission.findOne({
                    userId: entry.userId,
                    contestId: entry.contestId
                })
                    .populate('fileId', 'thumbnailUrl path title')
                    .populate('userId', 'name firstName email avatarUrl')
                    .lean();
            }

            // 🔧 FIX #3: Extract URLs from multiple possible locations
            const thumbnailUrl =
                sub?.fileId?.thumbnailUrl ??
                sub?.thumbnailUrl ??
                sub?.metadata?.thumbnailUrl ??
                null;

            const mediaUrl =
                sub?.fileId?.path ??
                sub?.mediaUrl ??
                sub?.metadata?.mediaUrl ??
                null;

            // 🔧 FIX #4: Better user name fallback chain
            const userData = sub?.userId;
            const userName = userData?.name ??
                userData?.firstName ??
                userData?.email?.split('@')[0] ??
                'Unknown';

            return {
                rank: entry.preliminaryRank,
                entryId: {
                    id: entry.entryId.toString(),
                    thumbnailUrl: thumbnailUrl,
                    mediaUrl: mediaUrl,
                },
                user: userData
                    ? {
                        name: userName,
                        avatarUrl: userData.avatarUrl ?? null,
                        email: userData.email ?? null, // Optional: include if needed by frontend
                    }
                    : null,
                scores: {
                    aiFinal: entry.scores.final,
                    themeMatch: entry.scores.theme,
                    technicalQuality: entry.scores.technical,
                    engagement: entry.scores.engagement,
                },
                preliminaryRank: entry.preliminaryRank,
                judgeStatus: sub?.status ?? 'pending',
                isSelected: !!decisionMap[entry.entryId.toString()],
                selectionDetails: decisionMap[entry.entryId.toString()] ?? null,
            };
        })
    );

    return {
        phase,
        canSelect: phase === 2,
        daysRemainingForSelection: phase === 2 ? daysRemainingForSelection : 0,
        revealAt: phase3Start.toISOString(),
        stats: {
            totalSubmissions: rankingResult.stats.totalEntries,
            approvedCount: rankingResult.stats.qualifiedCount,
            rejectedCount: rankingResult.stats.disqualifiedCount,
            shortlistedByJudge: existingDecisions.filter(d => d.finalDecision === 'winner').length,
        },
        topEntries: populatedEntries,
        leaderboard: populatedEntries,
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
        .populate('entryId')
        .populate('userId', 'name firstName username email avatarUrl')
        .sort({ position: 1 })
        .limit(limit)
        .lean();

    // if (judgeWinners.length > 0) {
    //     return {
    //         phase: 3,
    //         visible: true,
    //         source: 'judge',
    //         winners: judgeWinners.map(w => ({
    //             rank: w.position,
    //             entryId: w.entryId,
    //             userId: w.userId,
    //             aiScore: w.aiScore,
    //             aiRank: w.aiRank,
    //             overrideReason: w.overrideReason
    //         }))
    //     };
    // }

    if (judgeWinners.length > 0) {
        const FileMeta = require('../models/FileMeta');

        const populatedWinners = await Promise.all(
            judgeWinners.map(async (w) => {
                let mediaUrl = null;
                let thumbnailUrl = null;

                if (w.entryId?.fileId) {
                    const file = await FileMeta.findById(w.entryId.fileId)
                        .select('path thumbnailUrl')
                        .lean();
                    if (file) {
                        mediaUrl = file.path;
                        thumbnailUrl = file.thumbnailUrl || file.path;
                    }
                }

                if (!mediaUrl && w.entryId) {
                    mediaUrl = w.entryId.mediaUrl;
                    thumbnailUrl = w.entryId.thumbnailUrl || w.entryId.mediaUrl;
                }

                return {
                    rank: w.position,
                    entryId: w.entryId?._id?.toString() || null,
                    userId: w.userId?._id?.toString() || null,
                    userName: w.userId?.name || w.userId?.firstName || w.userId?.username || 'Unknown',
                    userAvatar: w.userId?.avatarUrl || null,
                    mediaUrl: mediaUrl,
                    thumbnailUrl: thumbnailUrl,
                    aiScore: w.aiScore,
                    aiRank: w.aiRank,
                    overrideReason: w.overrideReason,
                };
            })
        );

        return {
            phase: 3,
            visible: true,
            source: 'judge',
            winners: populatedWinners
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

    const Submission = require('../models/Submission');

    // Build decisions array AND fetch submission data for response
    const decisions = [];
    const winnersResponse = [];

    for (const sel of selections) {
        // 🔧 Find submission to get userId if not provided
        let userId = sel.userId;
        if (!userId) {
            const submission = await Submission.findById(sel.entryId)
                .select('userId aiScore')
                .lean();
            if (submission) {
                userId = submission.userId?.toString();
            }
        }

        const decision = {
            contestId,
            entryId: sel.entryId,
            userId: userId,
            judgeId: adminId,
            aiScore: sel.scores?.aiFinal ?? sel.aiScore ?? null,
            aiRank: sel.preliminaryRank ?? sel.rank ?? null,
            finalDecision: 'winner',
            position: sel.position || (decisions.length + 1),
            overrideReason: sel.overrideReason ?? null,
            selectedAt: new Date()
        };
        decisions.push(decision);

        // 🔧 Build response object matching Flutter model
        winnersResponse.push({
            entryId: sel.entryId,
            userId: userId,
            position: decision.position,
            status: decision.position === 1 ? 'winner' : 'shortlisted'
        });
    }

    await JudgeDecision.insertMany(decisions);

    // 🔧 Return response matching AdminSelectWinnerResponse model
    return {
        success: true,
        contestId,
        processedCount: decisions.length,
        winners: winnersResponse
    };
}

module.exports = {
    getTopEntriesForReview,
    getAdminPreview,
    getPublicWinners,
    selectWinners
};