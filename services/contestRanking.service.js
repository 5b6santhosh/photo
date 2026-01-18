const MLFeatureLog = require('../models/MLFeatureLog');

/**
 * AI-based ranking (Phase-2 now, Phase-3 ML later)
 */
async function getTopRankedEntries({ contestId, limit = 10 }) {

    const entries = await MLFeatureLog.find({
        contestId,
        verdict: { $in: ['approved', 'review'] }
    });

    const ranked = entries.map(entry => {

        const quality = entry.scores?.quality ?? 0;
        const theme = entry.scores?.theme ?? 0;
        const safety = Math.max(0, entry.scores?.safety ?? 0);
        const perceptual = entry.aiSignals?.perceptualQuality ?? 50;

        // ===============================
        // PHASE-2 (RULE / HEURISTIC)
        // ===============================
        const rankScore =
            0.45 * quality +
            0.30 * theme +
            0.15 * perceptual +
            0.10 * safety;

        // ===============================
        // PHASE-3 (ML – FUTURE)
        // ===============================
        /*
        const rankScore = await mlPredictRankScore({
          quality,
          theme,
          safety,
          perceptual,
          entropy: entry.features.entropy,
          skinRatio: entry.features.skinExposureRatio,
          aspectRatio: entry.features.aspectRatio
        });
        */

        return {
            entryId: entry.entryId,
            userId: entry.userId,
            contestId: entry.contestId,
            rankScore: Math.round(rankScore),
            breakdown: {
                quality,
                theme,
                safety,
                perceptual
            }
        };
    });

    // Sort descending
    ranked.sort((a, b) => b.rankScore - a.rankScore);

    // Assign AI rank
    return ranked.slice(0, limit).map((e, index) => ({
        ...e,
        aiRank: index + 1
    }));
}

module.exports = { getTopRankedEntries };
