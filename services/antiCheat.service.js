// ============================================
// ANTI-CHEAT SERVICE - CORRECTED VERSION
// ============================================

const MLFeatureLog = require('../models/MLFeatureLog');
const { generateImageHash, hammingDistance } = require('../utils/perceptualHash');
const CONFIG = require('../config');

/**
 * Detect duplicate submissions using perceptual hashing
 * Optimized with proper indexing and contestId filtering
 */
async function detectDuplicate(mediaPath, contestId) {
    try {
        // Generate hash for current media
        const hash = await generateImageHash(mediaPath);

        // Query optimization: Filter by contestId first, then check hashes
        // This significantly reduces the search space
        const previousEntries = await MLFeatureLog.find({
            contestId, // Same contest only
            'features.perceptualHash': { $exists: true, $ne: null }
        })
            .select('entryId features.perceptualHash contestId')
            .limit(500) // Safety limit
            .lean(); // Faster queries

        // Check for duplicates
        for (const entry of previousEntries) {
            const distance = hammingDistance(
                hash,
                entry.features.perceptualHash
            );

            // If distance is below threshold, it's a duplicate
            if (distance <= CONFIG.duplicateHashThreshold) {
                const similarity = Math.round(((64 - distance) / 64) * 100);

                return {
                    isDuplicate: true,
                    matchedEntryId: entry.entryId,
                    previousContestId: entry.contestId,
                    similarity,
                    hash,
                    distance
                };
            }
        }

        // No duplicates found
        return {
            isDuplicate: false,
            hash,
            checkedEntries: previousEntries.length
        };

    } catch (error) {
        console.error('Duplicate detection error:', error.message);

        // Fail open - return unique hash but log error
        return {
            isDuplicate: false,
            hash: null,
            error: error.message
        };
    }
}

/**
 * Cross-contest duplicate check (for admin tools)
 */
async function detectDuplicateGlobal(mediaPath, options = {}) {
    try {
        const hash = await generateImageHash(mediaPath);
        const { excludeContestId, limit = 1000 } = options;

        const query = {
            'features.perceptualHash': { $exists: true, $ne: null }
        };

        if (excludeContestId) {
            query.contestId = { $ne: excludeContestId };
        }

        const previousEntries = await MLFeatureLog.find(query)
            .select('entryId features.perceptualHash contestId userId')
            .limit(limit)
            .lean();

        const matches = [];

        for (const entry of previousEntries) {
            const distance = hammingDistance(hash, entry.features.perceptualHash);

            if (distance <= CONFIG.duplicateHashThreshold) {
                matches.push({
                    entryId: entry.entryId,
                    contestId: entry.contestId,
                    userId: entry.userId,
                    similarity: Math.round(((64 - distance) / 64) * 100),
                    distance
                });
            }
        }

        return {
            isDuplicate: matches.length > 0,
            hash,
            matches,
            checkedEntries: previousEntries.length
        };

    } catch (error) {
        console.error('Global duplicate detection error:', error.message);
        return {
            isDuplicate: false,
            hash: null,
            matches: [],
            error: error.message
        };
    }
}

/**
 * Bulk check for duplicate patterns (for fraud detection)
 */
async function findDuplicatePatterns(contestId) {
    try {
        const entries = await MLFeatureLog.find({
            contestId,
            'features.perceptualHash': { $exists: true, $ne: null }
        })
            .select('entryId userId features.perceptualHash')
            .lean();

        const duplicateGroups = [];
        const checked = new Set();

        for (let i = 0; i < entries.length; i++) {
            if (checked.has(entries[i].entryId.toString())) continue;

            const group = [entries[i]];
            checked.add(entries[i].entryId.toString());

            for (let j = i + 1; j < entries.length; j++) {
                if (checked.has(entries[j].entryId.toString())) continue;

                const distance = hammingDistance(
                    entries[i].features.perceptualHash,
                    entries[j].features.perceptualHash
                );

                if (distance <= CONFIG.duplicateHashThreshold) {
                    group.push(entries[j]);
                    checked.add(entries[j].entryId.toString());
                }
            }

            if (group.length > 1) {
                duplicateGroups.push({
                    count: group.length,
                    entries: group.map(e => ({
                        entryId: e.entryId,
                        userId: e.userId
                    }))
                });
            }
        }

        return {
            contestId,
            totalEntries: entries.length,
            duplicateGroups,
            totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.count, 0)
        };

    } catch (error) {
        console.error('Duplicate pattern detection error:', error.message);
        return {
            contestId,
            error: error.message,
            duplicateGroups: []
        };
    }
}

module.exports = {
    detectDuplicate,
    detectDuplicateGlobal,
    findDuplicatePatterns
};