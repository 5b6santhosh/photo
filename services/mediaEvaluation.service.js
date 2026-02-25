// ============================================
// MEDIA EVALUATION SERVICE
// ============================================

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const CONFIG = require('../config');
const { saveMLFeatures } = require('./mlFeatureLogger');
const { detectDuplicate } = require('./antiCheat.service');

try {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
} catch (err) {
    console.error('ffprobe not found — video evaluation disabled');
}

// ============================================
// GEMINI AI SETUP
// ============================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// gemini-1.5-flash: free tier = 15 RPM, 1 million TPM
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Robust JSON parser for Gemini responses.
 * Handles markdown code fences and extracts the outermost { } block.
 */
function parseGeminiJSON(text) {
    // Strip markdown fences if present
    const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    // Find outermost braces
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1) {
        throw new Error('No JSON object found in Gemini response');
    }
    return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Single Gemini multimodal call that evaluates NSFW, theme match, and quality
 * all at once — uses only 1 of the 15 free RPM quota per submission.
 *
 * @param {string} filePath   - Path to image or video thumbnail
 * @param {string} mimetype   - MIME type of the file (e.g. 'image/jpeg')
 * @param {string|null} theme - Contest theme string, or null
 * @returns {object} Structured AI insights
 */
async function performGeminiEvaluation(filePath, mimetype, theme) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('GEMINI_API_KEY not configured — skipping AI evaluation');
        return { skipped: true, error: false };
    }

    try {
        const fileBuffer = await fs.readFile(filePath);

        const imagePart = {
            inlineData: {
                data: fileBuffer.toString('base64'),
                mimeType: mimetype
            }
        };

        const prompt = `Analyze this media for a contest entry. Contest Theme: "${theme || 'General'}".

Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.
Use exactly these keys:
{
  "nsfw_score": <number 0.0–1.0, where 1.0 = explicit/inappropriate>,
  "theme_similarity": <number 0.0–1.0, where 1.0 = perfect theme match>,
  "perceptual_quality": <number 0–100, based on lighting, focus, and composition>,
  "is_ai_generated": <boolean, true if image/video looks synthetically generated>,
  "brief_reasoning": "<one sentence explaining the scores>"
}`;

        const result = await geminiModel.generateContent([prompt, imagePart]);
        const text = result.response.text();
        const data = parseGeminiJSON(text);

        // Validate expected keys exist
        if (
            typeof data.nsfw_score !== 'number' ||
            typeof data.theme_similarity !== 'number' ||
            typeof data.perceptual_quality !== 'number'
        ) {
            throw new Error('Gemini response missing required numeric fields');
        }

        const nsfwThreshold = CONFIG.nsfwThreshold ?? 0.7;
        const themeThreshold = CONFIG.themeThreshold ?? 0.6;

        return {
            isNSFW: data.nsfw_score > nsfwThreshold,
            nsfwProbability: data.nsfw_score,
            themeSimilarity: data.theme_similarity,
            themeMatched: data.theme_similarity > themeThreshold,
            perceptualQuality: data.perceptual_quality,
            isAIGenerated: data.is_ai_generated ?? false,
            explanation: data.brief_reasoning ?? '',
            error: false,
            skipped: false
        };

    } catch (error) {
        console.error('Gemini evaluation error:', error.message);
        return {
            isNSFW: false,
            nsfwProbability: 0,
            themeSimilarity: 0.5,
            themeMatched: false,
            perceptualQuality: 50,
            isAIGenerated: false,
            explanation: '',
            error: true,
            skipped: false
        };
    }
}

// ============================================
// PHASE 1: RULE-BASED ANALYSIS
// ============================================

async function analyzeMediaPhase1(filePath, mimetype, contestRules = null) {
    const isVideo = mimetype.startsWith('video');
    let metadata = {};
    let thumbnailPath = null;
    const tempFiles = [];
    const feedback = [];

    try {
        await fs.access(filePath);

        // Extract metadata and thumbnail
        if (isVideo) {
            const videoData = await extractVideoMetadata(filePath);
            metadata = videoData.metadata;
            thumbnailPath = videoData.thumbnailPath;
            tempFiles.push(thumbnailPath);
        } else {
            const imageData = await extractImageMetadata(filePath);
            metadata = imageData.metadata;
            thumbnailPath = filePath;
        }

        // Cache thumbnail stats — shared by quality & theme scorers
        const thumbnailStats = await sharp(thumbnailPath).stats();

        // Quality (0–40 pts)
        const qualityResult = scoreQuality(metadata, thumbnailStats, isVideo);
        const qualityScore = qualityResult.score;
        feedback.push(...qualityResult.feedback);

        // Safety (0–30 pts)
        const skinRatio = await detectSkinTones(thumbnailPath);
        const safetyResult = scoreSafety(metadata, skinRatio, isVideo);
        const safetyScore = safetyResult.score;
        feedback.push(...safetyResult.feedback);

        // Theme (0–30 pts)
        const themeResult = evaluateThemeWithRules(
            { stats: thumbnailStats, skinRatio, metadata, isVideo },
            contestRules
        );
        const themeScore = themeResult.score;
        feedback.push(...themeResult.feedback);

        // Cap each component before summing
        const cappedQuality = Math.max(0, Math.min(40, qualityScore));
        const cappedSafety = Math.max(0, Math.min(30, safetyScore));
        const cappedTheme = Math.max(0, Math.min(30, themeScore));
        const totalScore = cappedQuality + cappedSafety + cappedTheme;

        return {
            totalScore,
            breakdown: {
                quality: cappedQuality,
                safety: cappedSafety,
                theme: cappedTheme
            },
            metadata,
            feedback,
            skinRatio,
            thumbnailPath,
            thumbnailStats,
            tempFiles,
            isVideo,
            needsPhase2:
                totalScore < CONFIG.phase1Threshold ||
                skinRatio > 40 ||
                !themeResult.matched
        };

    } catch (error) {
        throw new Error(`Phase-1 analysis failed: ${error.message}`);
    }
}

// ============================================
// VIDEO METADATA + THUMBNAIL EXTRACTION
// ============================================

async function extractVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, probeData) => {
            if (err) return reject(new Error(`Invalid video file: ${err.message}`));

            const videoStream = probeData.streams.find(s => s.codec_type === 'video');
            if (!videoStream) return reject(new Error('No video stream found in file'));

            const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
            const format = probeData.format;

            let fps = 0;
            if (videoStream.r_frame_rate) {
                const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                fps = den && den > 0 ? num / den : 0;
            }

            const metadata = {
                width: videoStream.width || 0,
                height: videoStream.height || 0,
                duration: parseFloat(format.duration) || 0,
                bitrate: parseInt(format.bit_rate) || 0,
                format: format.format_name || 'unknown',
                fps,
                hasAudio: !!audioStream,
                fileSize: parseInt(format.size) || 0,
                brightness: null,
                entropy: null
            };

            const thumbTime = metadata.duration > 2 ? '1' : '0.5';
            const thumbnailPath = path.join(
                'uploads',
                `thumb_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`
            );

            ffmpeg(filePath)
                .on('error', thumbErr =>
                    reject(new Error(`Thumbnail extraction failed: ${thumbErr.message}`))
                )
                .on('end', async () => {
                    // Small delay to ensure ffmpeg has fully flushed the file to disk
                    await new Promise(r => setTimeout(r, 150));

                    try {
                        const thumbnailStats = await sharp(thumbnailPath).stats();

                        metadata.brightness =
                            thumbnailStats.channels.reduce((s, ch) => s + ch.mean, 0) /
                            thumbnailStats.channels.length;

                        metadata.entropy =
                            thumbnailStats.channels.reduce((s, ch) => s + (ch.entropy || 0), 0) /
                            thumbnailStats.channels.length;

                        resolve({ metadata, thumbnailPath });
                    } catch (sharpErr) {
                        reject(new Error(`Thumbnail stats failed: ${sharpErr.message}`));
                    }
                })
                .screenshots({
                    timestamps: [thumbTime],
                    filename: path.basename(thumbnailPath),
                    folder: path.dirname(thumbnailPath),
                    size: '1280x720'
                });
        });
    });
}

// ============================================
// IMAGE METADATA
// ============================================

async function extractImageMetadata(filePath) {
    const imgMeta = await sharp(filePath).metadata();

    if (!imgMeta.width || !imgMeta.height) {
        throw new Error('Invalid image: missing dimensions');
    }

    const stats = await fs.stat(filePath);

    return {
        metadata: {
            width: imgMeta.width,
            height: imgMeta.height,
            format: imgMeta.format,
            hasAudio: false,
            duration: 0,
            fileSize: stats.size
        }
    };
}

// ============================================
// QUALITY SCORER  (0–40 pts)
// ============================================

function scoreQuality(metadata, stats, isVideo) {
    let score = 0;
    const feedback = [];
    const { width, height } = metadata;
    const pixels = width * height;

    // Resolution (0–15 pts)
    if (pixels >= CONFIG.scoring.resolution.excellent) {
        score += 15;
        feedback.push('✓ Excellent resolution');
    } else if (pixels >= CONFIG.scoring.resolution.good) {
        score += 10;
        feedback.push('✓ Good resolution');
    } else {
        score += 5;
        feedback.push('⚠ Low resolution detected');
    }

    if (isVideo) {
        // Orientation (0–10 pts)
        const aspectRatio = width / height;
        if (aspectRatio < 0.7) {
            score += 10;
            feedback.push('✓ Vertical format (ideal for reels)');
        } else {
            score -= 5;
            feedback.push('⚠ Horizontal format — vertical is preferred');
        }

        // Duration (0–10 pts)
        if (metadata.duration > 0 && metadata.duration <= CONFIG.maxDuration) {
            score += 10;
            feedback.push(`✓ Duration (${metadata.duration.toFixed(1)}s) within limit`);
        } else if (metadata.duration > CONFIG.maxDuration) {
            score -= 15;
            feedback.push(`✗ Exceeds ${CONFIG.maxDuration}s duration limit`);
        }

        // FPS & Bitrate (0–10 pts)
        if (metadata.fps >= CONFIG.scoring.fps.good) {
            score += 5;
            feedback.push('✓ Good frame rate');
        }
        if (metadata.bitrate > CONFIG.scoring.bitrate.good) {
            score += 5;
            feedback.push('✓ Good bitrate quality');
        }
    } else {
        // Aspect ratio for images (0–10 pts)
        const ratio = width / height;
        if (ratio >= 0.8 && ratio <= 1.8) {
            score += 10;
            feedback.push('✓ Standard aspect ratio');
        } else {
            score += 5;
            feedback.push('⚠ Unusual aspect ratio');
        }
    }

    // Sharpness via standard deviation (0–10 pts)
    const avgStd = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    if (avgStd > CONFIG.scoring.sharpness.good) {
        score += 10;
        feedback.push('✓ Sharp, clear image');
    } else {
        score -= 5;
        feedback.push('⚠ Image appears blurry — improve focus');
    }

    // Brightness (0–5 pts)
    const avgBrightness = stats.channels.reduce((sum, ch) => sum + ch.mean, 0) / stats.channels.length;
    if (avgBrightness > CONFIG.scoring.brightness.min && avgBrightness < CONFIG.scoring.brightness.max) {
        score += 5;
        feedback.push('✓ Proper exposure');
    } else {
        score -= 5;
        feedback.push('⚠ Exposure issues detected');
    }

    return { score, feedback };
}

// ============================================
// SAFETY SCORER  (0–30 pts)
// Score starts at 0 and builds up — never exceeds 30.
// ============================================

function scoreSafety(metadata, skinRatio, isVideo) {
    let score = 0;
    const feedback = [];
    const fileSizeMB = metadata.fileSize / (1024 * 1024);

    // File size (0–15 pts)
    if (fileSizeMB <= CONFIG.maxSizeMB) {
        score += 15;
        feedback.push('✓ File size within limits');
    } else {
        feedback.push(`✗ File too large (${fileSizeMB.toFixed(1)}MB > ${CONFIG.maxSizeMB}MB)`);
    }

    // Skin tone ratio (0–10 pts)
    if (skinRatio > 60) {
        // Zero points — flagged for AI review
        feedback.push('⚠ High skin exposure — flagged for AI review');
    } else if (skinRatio > 40) {
        score += 5;
        feedback.push('⚠ Moderate skin tone detected');
    } else {
        score += 10;
        feedback.push('✓ Appropriate content exposure');
    }

    // Audio safety bonus for silent videos (0–5 pts)
    if (isVideo && !metadata.hasAudio) {
        score += 5;
        feedback.push('✓ Silent video (no audio concerns)');
    }

    return { score: Math.min(30, score), feedback };
}

// ============================================
// THEME SCORER  (0–30 pts)
// ============================================

function evaluateThemeWithRules({ stats, skinRatio, metadata, isVideo }, contestRules) {
    let score = 0;
    const feedback = [];

    if (!contestRules || !contestRules.theme) {
        return { score: 15, matched: true, feedback: ['ℹ No specific theme requirements'] };
    }

    const entropy = stats.channels
        .map(ch => ch.entropy || 0)
        .reduce((a, b) => a + b, 0) / stats.channels.length;

    // Entropy / visual complexity check (0–10 pts)
    if (contestRules.minEntropy && entropy < contestRules.minEntropy) {
        feedback.push('⚠ Low visual complexity for contest theme');
    } else if (contestRules.maxEntropy && entropy > contestRules.maxEntropy) {
        feedback.push('⚠ Too visually complex for contest theme');
    } else {
        score += 10;
        feedback.push('✓ Visual complexity matches theme');
    }

    // Skin exposure range check (0–10 pts)
    if (contestRules.skinRange && Array.isArray(contestRules.skinRange)) {
        const [minSkin, maxSkin] = contestRules.skinRange;
        if (skinRatio >= minSkin && skinRatio <= maxSkin) {
            score += 10;
            feedback.push('✓ Content exposure within contest guidelines');
        } else {
            feedback.push('⚠ Content exposure outside contest preference');
        }
    }

    // Orientation requirement (0–5 pts)
    if (contestRules.requireVertical && isVideo) {
        const ratio = metadata.width / metadata.height;
        if (ratio < 0.7) {
            score += 5;
            feedback.push('✓ Vertical format matches contest');
        } else {
            feedback.push('⚠ Contest prefers vertical format');
        }
    }

    // Color preference heuristic (0–5 pts)
    if (contestRules.preferredColor === 'green') {
        if (stats.channels.length >= 3 && stats.channels[1]?.mean > stats.channels[0]?.mean) {
            score += 5;
            feedback.push('✓ Color tone aligns with theme');
        }
    }

    return {
        score: Math.min(30, score),
        matched: score >= 15,
        feedback
    };
}

// ============================================
// SKIN TONE DETECTION
// ============================================

async function detectSkinTones(imagePath) {
    try {
        const { data, info } = await sharp(imagePath)
            .resize(200, 200, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });

        let skinPixels = 0;
        const totalPixels = info.width * info.height;

        for (let i = 0; i < data.length; i += 3) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            if (
                r > 90 && g > 40 && b > 20 &&
                r > g && r > b &&
                Math.abs(r - g) < 100 &&
                (r - g) > 15
            ) {
                skinPixels++;
            }
        }

        return Number(((skinPixels / totalPixels) * 100).toFixed(2));
    } catch (err) {
        console.error('Skin detection error:', err.message);
        return 0;
    }
}

// ============================================
// MAIN EVALUATION FUNCTION
// ============================================

async function evaluateMedia(filePath, mimetype, contestRules) {
    const startTime = Date.now();
    let tempFiles = [];

    try {
        if (!contestRules || !contestRules.contestId) {
            throw new Error('Contest rules with contestId required');
        }

        console.log('🔍 Starting Phase-1 evaluation...');
        const phase1 = await analyzeMediaPhase1(filePath, mimetype, contestRules);
        tempFiles = phase1.tempFiles;

        let finalScore = phase1.totalScore;
        let verdict = 'approved';
        let aiInsights = null;
        const allFeedback = [...phase1.feedback];

        // Duplicate detection
        console.log('🔍 Checking for duplicates...');
        const duplicateCheck = await detectDuplicate(phase1.thumbnailPath, contestRules.contestId);

        if (duplicateCheck.isDuplicate) {
            verdict = 'rejected';
            finalScore = 0;
            allFeedback.push(
                `✗ Duplicate content detected (${duplicateCheck.similarity}% match with entry ${duplicateCheck.matchedEntryId})`
            );
        }

        if (!phase1.features) phase1.features = {};
        phase1.features.perceptualHash = duplicateCheck.hash;

        // ─── Phase 2: Single Gemini call (1 RPM used) ───────────────────────
        if (CONFIG.enablePhase2 && phase1.needsPhase2 && !duplicateCheck.isDuplicate) {
            console.log('🤖 Phase-2 triggered — running Gemini AI evaluation...');

            // For video, evaluate the extracted thumbnail (JPEG).
            // For images, evaluate the original file directly.
            const mediaToAnalyze = phase1.isVideo ? phase1.thumbnailPath : filePath;
            const mediaMime = phase1.isVideo ? 'image/jpeg' : mimetype;

            const geminiResult = await performGeminiEvaluation(
                mediaToAnalyze,
                mediaMime,
                contestRules?.theme
            );

            if (!geminiResult.skipped) {
                // Build aiInsights in the same shape the rest of the code expects
                aiInsights = {
                    isNSFW: geminiResult.isNSFW,
                    nsfwProbability: geminiResult.nsfwProbability,
                    themeSimilarity: geminiResult.themeSimilarity,
                    themeMatched: geminiResult.themeMatched,
                    perceptualQuality: geminiResult.perceptualQuality,
                    isAIGenerated: geminiResult.isAIGenerated,
                    explanation: geminiResult.explanation,
                    // Sharpness derived from Phase-1 stats (no extra API call needed)
                    sharpness: Math.round(
                        Math.min(
                            100,
                            (phase1.thumbnailStats.channels.reduce((s, ch) => s + ch.stdev, 0) /
                                phase1.thumbnailStats.channels.length / 50) * 100
                        )
                    )
                };

                // ── NSFW verdict ─────────────────────────────────────────────
                if (geminiResult.isNSFW) {
                    phase1.breakdown.safety = -50;
                    finalScore = -50;
                    verdict = 'rejected';
                    allFeedback.push('✗ Gemini detected inappropriate content');
                } else if (!geminiResult.error) {
                    allFeedback.push('✓ Gemini safety check passed');
                }

                // ── Theme adjustment ─────────────────────────────────────────
                if (contestRules?.theme && !geminiResult.error) {
                    if (geminiResult.themeMatched) {
                        phase1.breakdown.theme = Math.max(phase1.breakdown.theme, 25);
                        allFeedback.push(
                            `✓ AI Theme Match: ${Math.round(geminiResult.themeSimilarity * 100)}%`
                        );
                    } else {
                        phase1.breakdown.theme = Math.min(phase1.breakdown.theme, 10);
                        allFeedback.push(
                            `⚠ AI: Low theme relevance (${Math.round(geminiResult.themeSimilarity * 100)}%)`
                        );
                    }
                }

                // ── Quality boost ────────────────────────────────────────────
                if (!geminiResult.error && geminiResult.perceptualQuality > 75) {
                    phase1.breakdown.quality = Math.min(40, phase1.breakdown.quality + 10);
                    allFeedback.push('✓ AI: High perceptual quality detected');
                }

                // ── AI-generated content flag ────────────────────────────────
                if (geminiResult.isAIGenerated) {
                    allFeedback.push('⚠ AI: Submission may be synthetically generated');
                }

                // Recalculate total only if not already hard-rejected
                if (verdict !== 'rejected') {
                    finalScore = Object.values(phase1.breakdown).reduce((a, b) => a + b, 0);
                    finalScore = Math.max(0, Math.min(100, finalScore));
                }
            } else {
                allFeedback.push('⚠ AI evaluation skipped — relying on rule-based analysis');
            }
        }

        // Final verdict
        if (verdict !== 'rejected') {
            if (finalScore >= 70) verdict = 'approved';
            else if (finalScore >= 50) verdict = 'review';
            else verdict = 'rejected';
        }

        const explanation = buildExplanation({ phase1, aiInsights, verdict, finalScore });

        await saveMLFeatures({
            contestId: contestRules.contestId,
            entryId: contestRules.entryId,
            userId: contestRules.userId,
            phase1,
            aiInsights,
            verdict,
            finalScore,
            perceptualHash: duplicateCheck.hash,
            brightness: phase1.metadata?.brightness ?? null,
            entropy: phase1.metadata?.entropy ?? null,
            duplicateOf: duplicateCheck.isDuplicate ? duplicateCheck.matchedEntryId : null
        });

        return {
            success: true,
            score: Math.max(0, Math.min(100, finalScore)),
            verdict,
            feedback: allFeedback.join(' | '),
            explanation,
            breakdown: phase1.breakdown,
            metadata: phase1.metadata,
            mediaType: phase1.isVideo ? 'video' : 'image',
            phase2Used: aiInsights !== null,
            aiInsights,
            processingTime: `${Date.now() - startTime}ms`
        };

    } catch (error) {
        console.error('Evaluation failed:', error);
        return {
            success: false,
            error: error.message,
            score: 0,
            verdict: 'error',
            processingTime: `${Date.now() - startTime}ms`
        };
    } finally {
        if (tempFiles.length > 0) {
            setTimeout(async () => {
                for (const file of tempFiles) {
                    try {
                        await fs.access(file);
                        await fs.unlink(file);
                    } catch (_) { /* already gone */ }
                }
                tempFiles.length = 0;
            }, CONFIG.tempFileRetention);
        }
    }
}

// ============================================
// EXPLANATION BUILDER
// ============================================

function buildExplanation({ phase1, aiInsights, verdict, finalScore }) {
    const reasons = [];

    if (phase1.breakdown.quality >= 30) reasons.push('✓ Image quality meets contest standards');
    else if (phase1.breakdown.quality >= 20) reasons.push('⚠ Image quality is acceptable but could be improved');
    else reasons.push('✗ Image quality is below contest standards');

    if (phase1.breakdown.safety >= 20) reasons.push('✓ No safety violations detected');
    else if (phase1.breakdown.safety >= 10) reasons.push('⚠ Minor safety concerns detected');
    else reasons.push('✗ Safety concerns require review');

    if (phase1.breakdown.theme >= 20) reasons.push('✓ Submission aligns well with contest theme');
    else if (phase1.breakdown.theme >= 10) reasons.push('⚠ Theme relevance could be stronger');
    else reasons.push('✗ Theme relevance is weak or unclear');

    if (aiInsights) {
        if (aiInsights.isNSFW) {
            reasons.push('✗ AI flagged content as inappropriate');
        }
        if (aiInsights.themeMatched === false && aiInsights.themeSimilarity < 0.3) {
            reasons.push('✗ AI found low semantic similarity to theme');
        }
        if (aiInsights.isAIGenerated) {
            reasons.push('⚠ Submission may be AI-generated synthetic media');
        }
        if (aiInsights.explanation) {
            reasons.push(`ℹ AI reasoning: ${aiInsights.explanation}`);
        }
    }

    let summary;
    if (verdict === 'approved') {
        summary = `✓ Your submission meets the contest requirements (Score: ${finalScore}/100)`;
    } else if (verdict === 'review') {
        summary = `⚠ Your submission needs human review (Score: ${finalScore}/100)`;
    } else {
        summary = `✗ Your submission did not meet contest requirements (Score: ${finalScore}/100)`;
    }

    return { verdict, summary, reasons, score: finalScore };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    evaluateMedia,
    analyzeMediaPhase1,
    performGeminiEvaluation
};