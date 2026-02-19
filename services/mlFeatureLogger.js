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
    finalScore,
    perceptualHash,
    brightness,
    entropy,
    duplicateOf = null

}) {
    try {
        const meta = phase1.metadata;

        const width = meta.width || 0;
        const height = meta.height || 0;

        //  ADD THIS BLOCK: Calculate color dominance
        let colorDominance = { red: 0, green: 0, blue: 0 };
        if (phase1.thumbnailPath) {
            try {
                const sharp = require('sharp'); // Add at top of file if not there
                const { data, info } = await sharp(phase1.thumbnailPath)
                    .resize(100, 100, { fit: 'inside' })
                    .raw()
                    .toBuffer({ resolveWithObject: true });

                let r = 0, g = 0, b = 0, total = 0;
                for (let i = 0; i < data.length; i += 3) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    total++;
                }

                const sum = r + g + b;
                colorDominance = {
                    red: sum > 0 ? Number((r / sum).toFixed(3)) : 0,
                    green: sum > 0 ? Number((g / sum).toFixed(3)) : 0,
                    blue: sum > 0 ? Number((b / sum).toFixed(3)) : 0
                };
            } catch (err) {
                console.warn('Color analysis failed:', err.message);
            }
        }

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

                sharpness: aiInsights?.sharpness ?? phase1.metadata?.sharpness ?? null,
                brightness: brightness ?? phase1.metadata?.brightness ?? null,
                contrast: aiInsights?.contrast ?? null,
                entropy: entropy ?? phase1.metadata?.entropy ?? null,

                skinExposureRatio: Number((phase1.skinRatio ?? 0).toFixed(2)),
                hasAudio: Boolean(meta.hasAudio),

                duration: meta.duration ?? 0,
                fps: meta.fps ?? 0,
                bitrate: meta.bitrate ?? 0,
                perceptualHash: perceptualHash ?? null,

                colorDominance
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
            duplicateOf,
            modelVersion: 'phase1+phase2'
        };

        await MLFeatureLog.create(featureDoc);

    } catch (err) {
        console.warn(' ML feature logging failed:', err.message);
    }
}

module.exports = { saveMLFeatures };
