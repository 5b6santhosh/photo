// ============================================
// MEDIA EVALUATION SERVICE - CORRECTED VERSION
// ============================================

const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const CONFIG = require('../config');
const { saveMLFeatures } = require('./mlFeatureLogger');
const { detectDuplicate } = require('./antiCheat.service');

ffmpeg.setFfprobePath(ffprobeStatic.path);

// ============================================
// PHASE 1: RULE-BASED ANALYSIS
// ============================================

async function analyzeMediaPhase1(filePath, mimetype, contestRules = null) {
    const isVideo = mimetype.startsWith('video');
    let metadata = {};
    let thumbnailPath = null;
    const tempFiles = [];
    const feedback = [];

    let qualityScore = 0;
    let safetyScore = 30; // Start with base safety score
    let themeScore = 0;

    try {
        // Verify file exists
        await fs.access(filePath);

        // === EXTRACT METADATA & THUMBNAIL ===
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

        // Cache thumbnail stats for reuse
        const thumbnailStats = await sharp(thumbnailPath).stats();

        // === QUALITY SCORING (40 points max) ===
        const qualityResult = scoreQuality(metadata, thumbnailStats, isVideo);
        qualityScore = qualityResult.score;
        feedback.push(...qualityResult.feedback);

        // === SAFETY SCORING (30 points max) ===
        const skinRatio = await detectSkinTones(thumbnailPath);
        const safetyResult = scoreSafety(metadata, skinRatio, isVideo);
        safetyScore = safetyResult.score;
        feedback.push(...safetyResult.feedback);

        // === THEME SCORING (30 points max) ===
        const themeResult = evaluateThemeWithRules(
            { stats: thumbnailStats, skinRatio, metadata, isVideo },
            contestRules
        );
        themeScore = themeResult.score;
        feedback.push(...themeResult.feedback);

        const totalScore = qualityScore + safetyScore + themeScore;

        return {
            totalScore,
            breakdown: {
                quality: Math.max(0, Math.min(40, qualityScore)),
                safety: Math.max(0, Math.min(30, safetyScore)),
                theme: Math.max(0, Math.min(30, themeScore))
            },
            metadata,
            feedback,
            skinRatio,
            thumbnailPath,
            thumbnailStats, // Cache for Phase 2
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
// HELPER FUNCTIONS
// ============================================

async function extractVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, async (err, probeData) => {
            if (err) {
                return reject(new Error(`Invalid video file: ${err.message}`));
            }

            const videoStream = probeData.streams.find(s => s.codec_type === 'video');
            if (!videoStream) {
                return reject(new Error('No video stream found in file'));
            }

            const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
            const format = probeData.format;

            // Safe FPS calculation
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
                fileSize: parseInt(format.size) || 0
            };

            // Extract thumbnail
            const thumbTime = metadata.duration > 2 ? '1' : '0.5';
            const thumbnailPath = path.join('uploads', `thumb_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);

            ffmpeg(filePath)
                .on('error', (thumbErr) => reject(new Error(`Thumbnail extraction failed: ${thumbErr.message}`)))
                .on('end', () => resolve({ metadata, thumbnailPath }))
                .screenshots({
                    timestamps: [thumbTime],
                    filename: path.basename(thumbnailPath),
                    folder: path.dirname(thumbnailPath),
                    size: '1280x720'
                });
        });
    });
}

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

function scoreQuality(metadata, stats, isVideo) {
    let score = 0;
    const feedback = [];
    const { width, height } = metadata;
    const pixels = width * height;

    // 1. Resolution (0-15 points)
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

    // 2. Orientation (video: 0-10 points)
    if (isVideo) {
        const aspectRatio = width / height;
        if (aspectRatio < 0.7) {
            score += 10;
            feedback.push('✓ Vertical format (ideal for reels)');
        } else {
            score -= 5;
            feedback.push('⚠ Horizontal format - vertical is preferred');
        }

        // 3. Duration (0-10 points)
        if (metadata.duration > 0 && metadata.duration <= CONFIG.maxDuration) {
            score += 10;
            feedback.push(`✓ Duration (${metadata.duration.toFixed(1)}s) within limit`);
        } else if (metadata.duration > CONFIG.maxDuration) {
            score -= 15;
            feedback.push(`✗ Exceeds ${CONFIG.maxDuration}s duration limit`);
        }

        // 4. FPS & Bitrate (0-10 points)
        if (metadata.fps >= CONFIG.scoring.fps.good) {
            score += 5;
            feedback.push('✓ Good frame rate');
        }
        if (metadata.bitrate > CONFIG.scoring.bitrate.good) {
            score += 5;
            feedback.push('✓ Good bitrate quality');
        }
    } else {
        // Image: aspect ratio (0-10 points)
        const ratio = width / height;
        if (ratio >= 0.8 && ratio <= 1.8) {
            score += 10;
            feedback.push('✓ Standard aspect ratio');
        } else {
            score += 5;
            feedback.push('⚠ Unusual aspect ratio');
        }
    }

    // 5. Sharpness (0-10 points)
    const avgStd = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    if (avgStd > CONFIG.scoring.sharpness.good) {
        score += 10;
        feedback.push('✓ Sharp, clear image');
    } else {
        score -= 5;
        feedback.push('⚠ Image appears blurry - improve focus');
    }

    // 6. Brightness (0-5 points)
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

function scoreSafety(metadata, skinRatio, isVideo) {
    let score = 0; // Start with full safety score
    const feedback = [];
    const fileSizeMB = metadata.fileSize / (1024 * 1024);

    // 1. File size (0-15 points)
    if (fileSizeMB <= CONFIG.maxSizeMB) {
        score += 15;
        feedback.push('✓ File size within limits');
    } else {
        score -= 20;
        feedback.push(`✗ File too large (${fileSizeMB.toFixed(1)}MB > ${CONFIG.maxSizeMB}MB)`);
    }

    // 2. Skin tone detection (0-10 points, can reduce score)
    if (skinRatio > 60) {
        score -= 20;
        feedback.push('⚠ High skin exposure - flagged for AI review');
    } else if (skinRatio > 40) {
        score -= 10;
        feedback.push('⚠ Moderate skin tone detected');
    } else {
        score += 10;
        feedback.push('✓ Appropriate content exposure');
    }

    // 3. Audio check (bonus for videos)
    if (isVideo && !metadata.hasAudio) {
        score += 5;
        feedback.push('✓ Silent video (no audio concerns)');
    }

    return { score, feedback };
}

function evaluateThemeWithRules({ stats, skinRatio, metadata, isVideo }, contestRules) {
    let score = 0;
    const feedback = [];

    if (!contestRules || !contestRules.theme) {
        return {
            score: 15,
            matched: true,
            feedback: ['ℹ No specific theme requirements']
        };
    }

    // Calculate entropy
    // const entropy = stats.channels.reduce((sum, ch) => sum + (ch.entropy || 0), 0) / stats.channels.length;
    const entropy = stats.channels
        .map(ch => ch.entropy || 0)
        .reduce((a, b) => a + b, 0) / stats.channels.length;


    // 1. Entropy check (0-10 points)
    if (contestRules.minEntropy && entropy < contestRules.minEntropy) {
        feedback.push('⚠ Low visual complexity for contest theme');
    } else if (contestRules.maxEntropy && entropy > contestRules.maxEntropy) {
        feedback.push('⚠ Too visually complex for contest theme');
    } else {
        score += 10;
        feedback.push('✓ Visual complexity matches theme');
    }

    // 2. Skin exposure rules (0-10 points)
    if (contestRules.skinRange && Array.isArray(contestRules.skinRange)) {
        const [minSkin, maxSkin] = contestRules.skinRange;
        if (skinRatio >= minSkin && skinRatio <= maxSkin) {
            score += 10;
            feedback.push('✓ Content exposure within contest guidelines');
        } else {
            feedback.push('⚠ Content exposure outside contest preference');
        }
    }

    // 3. Orientation requirement (0-5 points)
    if (contestRules.requireVertical && isVideo) {
        const ratio = metadata.width / metadata.height;
        if (ratio < 0.7) {
            score += 5;
            feedback.push('✓ Vertical format matches contest');
        } else {
            feedback.push('⚠ Contest prefers vertical format');
        }
    }

    // 4. Color preference (0-5 points - basic heuristic)
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

            // Improved skin detection algorithm
            if (r > 90 && g > 40 && b > 20 &&
                r > g && r > b &&
                Math.abs(r - g) < 100 &&
                (r - g) > 15) {
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
// PHASE 2: AI-POWERED CHECKS
// ============================================

async function checkNSFW(imagePath) {
    if (!CONFIG.huggingFaceToken) {
        console.warn('HF_TOKEN not configured - skipping NSFW check');
        return { isNSFW: false, score: 0, confidence: 0, skipped: true };
    }

    try {
        const imageBuffer = await fs.readFile(imagePath);

        const response = await axios.post(
            'https://api-inference.huggingface.co/models/Falconsai/nsfw_image_detection',
            imageBuffer,
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.huggingFaceToken}`,
                    'Content-Type': 'application/octet-stream'
                },
                timeout: 15000
            }
        );

        const nsfwLabels = ['nsfw', 'porn', 'sexy'];
        const nsfwResult = response.data.find(r => nsfwLabels.includes(r.label.toLowerCase()));

        return {
            isNSFW: nsfwResult && nsfwResult.score > CONFIG.nsfwThreshold,
            score: nsfwResult?.score || 0,
            confidence: nsfwResult?.score || 0
        };
    } catch (error) {
        console.error('NSFW check failed:', error.message);
        return { isNSFW: false, score: 0, confidence: 0, error: true };
    }
}

async function matchTheme(imagePath, theme) {
    if (!theme) {
        return { similarity: 0.5, matched: true, skipped: true };
    }

    if (!CONFIG.huggingFaceToken) {
        console.warn('HF_TOKEN not configured - skipping theme match');
        return { similarity: 0.5, matched: false, skipped: true };
    }

    try {
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = imageBuffer.toString('base64');

        const response = await axios.post(
            'https://api-inference.huggingface.co/models/openai/clip-vit-large-patch14',
            {
                inputs: {
                    image: base64Image,
                    candidate_labels: [theme, 'unrelated content', 'random image']
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.huggingFaceToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );

        const themeSimilarity = response.data[0]?.score || 0.3;

        return {
            similarity: themeSimilarity,
            matched: themeSimilarity > CONFIG.themeThreshold,
            confidence: themeSimilarity
        };
    } catch (error) {
        console.error('Theme matching failed:', error.message);
        return { similarity: 0.3, matched: false, error: true };
    }
}

async function assessImageQuality(imagePath, cachedStats = null) {
    try {
        const image = sharp(imagePath);
        const stats = cachedStats || await image.stats();

        const { data } = await image
            .greyscale()
            .resize(512, 512, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Edge detection for sharpness
        let edgeStrength = 0;
        for (let i = 1; i < data.length - 1; i++) {
            edgeStrength += Math.abs(data[i] - data[i - 1]);
        }
        const sharpness = Math.min(100, (edgeStrength / data.length) * 2);

        // Contrast from standard deviation
        const contrast = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
        const normalizedContrast = Math.min(100, (contrast / 50) * 100);

        const qualityScore = (sharpness * 0.6 + normalizedContrast * 0.4);

        return {
            score: Math.round(qualityScore),
            sharpness: Math.round(sharpness),
            contrast: Math.round(normalizedContrast),
            isGood: qualityScore > 60
        };
    } catch (error) {
        console.error('Quality assessment failed:', error.message);
        return { score: 50, sharpness: 50, contrast: 50, isGood: true, error: true };
    }
}

// ============================================
// MAIN EVALUATION FUNCTION
// ============================================

async function evaluateMedia(filePath, mimetype, contestRules) {
    const startTime = Date.now();
    let tempFiles = [];
    let cleanupTimer = null;

    try {
        // Validate inputs
        if (!contestRules || !contestRules.contestId) {
            throw new Error('Contest rules with contestId required');
        }

        // PHASE 1: Rule-based analysis
        console.log('🔍 Starting Phase-1 evaluation...');
        const phase1 = await analyzeMediaPhase1(filePath, mimetype, contestRules);
        tempFiles = phase1.tempFiles;

        let finalScore = phase1.totalScore;
        let verdict = 'approved';
        let aiInsights = null;
        const allFeedback = [...phase1.feedback];

        // Anti-cheat: Duplicate detection
        console.log('🔍 Checking for duplicates...');
        const duplicateCheck = await detectDuplicate(
            phase1.thumbnailPath,
            contestRules.contestId
        );

        if (duplicateCheck.isDuplicate) {
            verdict = 'rejected';
            finalScore = 0;
            allFeedback.push(
                `✗ Duplicate content detected (${duplicateCheck.similarity}% match with entry ${duplicateCheck.matchedEntryId})`
            );
        }

        // Store perceptual hash
        if (!phase1.features) phase1.features = {};
        phase1.features.perceptualHash = duplicateCheck.hash;

        // PHASE 2: AI-powered checks (if needed and not duplicate)
        if (CONFIG.enablePhase2 && phase1.needsPhase2 && !duplicateCheck.isDuplicate) {
            console.log('🤖 Phase-2 triggered - Running AI checks...');

            try {
                const [nsfwCheck, themeMatch, qualityCheck] = await Promise.allSettled([
                    checkNSFW(phase1.thumbnailPath),
                    matchTheme(phase1.thumbnailPath, contestRules?.theme),
                    assessImageQuality(phase1.thumbnailPath, phase1.thumbnailStats)
                ]);

                const nsfw = nsfwCheck.status === 'fulfilled' ? nsfwCheck.value : { isNSFW: false, error: true };
                const themeResult = themeMatch.status === 'fulfilled' ? themeMatch.value : { matched: false, error: true };
                const quality = qualityCheck.status === 'fulfilled' ? qualityCheck.value : { score: 50, error: true };

                // Build AI insights
                aiInsights = {
                    nsfwProbability: nsfw.score,
                    isNSFW: nsfw.isNSFW,
                    themeSimilarity: themeResult.similarity,
                    themeMatched: themeResult.matched,
                    perceptualQuality: quality.score,
                    sharpness: quality.sharpness,
                    contrast: quality.contrast
                };

                // Adjust scores based on AI findings
                if (nsfw.isNSFW) {
                    phase1.breakdown.safety = -50;
                    finalScore = -50;
                    verdict = 'rejected';
                    allFeedback.push('✗ AI detected inappropriate content');
                } else if (!nsfw.error) {
                    allFeedback.push('✓ AI safety check passed');
                }

                // Theme validation
                if (contestRules?.theme) {
                    if (themeResult.matched && !themeResult.error) {
                        phase1.breakdown.theme = Math.max(phase1.breakdown.theme, 25);
                        allFeedback.push(
                            `✓ AI confirmed theme match (${Math.round(themeResult.similarity * 100)}% confidence)`
                        );
                    } else if (!themeResult.matched && !themeResult.error) {
                        phase1.breakdown.theme = Math.min(phase1.breakdown.theme, 10);
                        allFeedback.push(
                            `⚠ AI: Low theme relevance (${Math.round(themeResult.similarity * 100)}% confidence)`
                        );
                    }
                }

                // Quality boost
                if (quality.score > 70 && !quality.error) {
                    phase1.breakdown.quality = Math.min(40, phase1.breakdown.quality + 10);
                    allFeedback.push('✓ AI: High perceptual quality detected');
                }

                // Recalculate final score
                finalScore = Object.values(phase1.breakdown).reduce((a, b) => a + b, 0);
                finalScore = Math.max(0, Math.min(100, finalScore));

            } catch (aiError) {
                console.warn('⚠ Phase-2 partial failure:', aiError.message);
                allFeedback.push('⚠ Some AI checks failed - relying on rule-based analysis');
            }
        }

        // Determine final verdict
        if (verdict !== 'rejected') { // Don't override rejection
            if (finalScore >= 70) {
                verdict = 'approved';
            } else if (finalScore >= 50) {
                verdict = 'review';
            } else {
                verdict = 'rejected';
            }
        }

        const explanation = buildExplanation({
            phase1,
            aiInsights,
            verdict,
            finalScore
        });

        // Log ML features for training
        await saveMLFeatures({
            contestId: contestRules.contestId,
            entryId: contestRules.entryId,
            userId: contestRules.userId,
            phase1,
            aiInsights,
            verdict,
            finalScore,
            perceptualHash: phase1.features?.perceptualHash
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
        console.error('❌ Evaluation failed:', error);
        return {
            success: false,
            error: error.message,
            score: 0,
            verdict: 'error',
            processingTime: `${Date.now() - startTime}ms`
        };
    } finally {
        // Delayed cleanup to prevent race conditions
        if (tempFiles.length > 0) {
            cleanupTimer = setTimeout(async () => {
                for (const file of tempFiles) {
                    try {
                        await fs.access(file);
                        await fs.unlink(file);
                        console.log(`🗑 Cleaned up temp file: ${path.basename(file)}`);
                    } catch (err) {
                        // File already deleted or doesn't exist
                    }
                }
            }, CONFIG.tempFileRetention);
        }
    }
}

function buildExplanation({ phase1, aiInsights, verdict, finalScore }) {
    const reasons = [];

    // Quality assessment
    if (phase1.breakdown.quality >= 30) {
        reasons.push('✓ Image quality meets contest standards');
    } else if (phase1.breakdown.quality >= 20) {
        reasons.push('⚠ Image quality is acceptable but could be improved');
    } else {
        reasons.push('✗ Image quality is below contest standards');
    }

    // Safety assessment
    if (phase1.breakdown.safety >= 20) {
        reasons.push('✓ No safety violations detected');
    } else if (phase1.breakdown.safety >= 10) {
        reasons.push('⚠ Minor safety concerns detected');
    } else {
        reasons.push('✗ Safety concerns require review');
    }

    // Theme assessment
    if (phase1.breakdown.theme >= 20) {
        reasons.push('✓ Submission aligns well with contest theme');
    } else if (phase1.breakdown.theme >= 10) {
        reasons.push('⚠ Theme relevance could be stronger');
    } else {
        reasons.push('✗ Theme relevance is weak or unclear');
    }

    // AI insights
    if (aiInsights) {
        if (aiInsights.isNSFW) {
            reasons.push('✗ AI flagged content as inappropriate');
        }
        if (aiInsights.themeMatched === false && aiInsights.themeSimilarity < 0.3) {
            reasons.push('✗ AI found low semantic similarity to theme');
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

    return {
        verdict,
        summary,
        reasons,
        score: finalScore
    };
}

module.exports = {
    evaluateMedia,
    analyzeMediaPhase1, // For testing
    checkNSFW, // For testing
    matchTheme, // For testing
    assessImageQuality // For testing
};