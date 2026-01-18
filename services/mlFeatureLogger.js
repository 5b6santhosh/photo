const MLFeatureLog = require('../models/MLFeatureLog');
const { safeDivide } = require('../utils/featureUtils');

/**
 * Logs ML-ready features (NO decision logic)
 */
async function saveMLFeatures({
    contestId,
    entryId,
    userId,
    phase1,
    aiInsights,
    verdict,
    finalScore
}) {
    try {
        const meta = phase1.metadata;

        const width = meta.width || 0;
        const height = meta.height || 0;

        const featureDoc = {
            contestId,
            entryId,
            userId,
            mediaType: phase1.isVideo ? 'video' : 'image',

            // ======================
            //  RAW FEATURES (PHASE-1)
            // ======================
            features: {
                width,
                height,
                aspectRatio: safeDivide(width, height),
                megapixels: safeDivide(width * height, 1_000_000),

                // Image statistics (not scores)
                sharpness: aiInsights?.sharpness ?? null,
                brightness: phase1.metadata?.brightness ?? null,
                contrast: aiInsights?.contrast ?? null,
                entropy: phase1.metadata?.entropy ?? null,

                // Safety
                skinExposureRatio: Number((phase1.skinRatio ?? 0).toFixed(2)),
                hasAudio: Boolean(meta.hasAudio),

                // Video only
                duration: meta.duration ?? 0,
                fps: meta.fps ?? 0,
                bitrate: meta.bitrate ?? 0,
                perceptualHash: phase1.features?.perceptualHash ?? null
            },

            // ======================
            //  AI SIGNALS (PHASE-2)
            // ======================
            aiSignals: aiInsights ? {
                nsfwScore: aiInsights.nsfwProbability ?? 0,
                themeSimilarity: aiInsights.themeSimilarity ?? 0,
                perceptualQuality: aiInsights.perceptualQuality ?? 50
            } : {},

            // ======================
            //  SCORES (LABELS)
            // ======================
            scores: {
                quality: phase1.breakdown.quality,
                safety: phase1.breakdown.safety,
                theme: phase1.breakdown.theme,
                finalScore
            },

            verdict,
            modelVersion: 'phase1+phase2'
        };

        await MLFeatureLog.create(featureDoc);

    } catch (err) {
        console.warn(' ML feature logging failed:', err.message);
    }
}

module.exports = { saveMLFeatures };
