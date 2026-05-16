// utils/badgeUtils.js
// 🔧 COMPLEX FORMULA: wins + submissions + followers + streakDays

const User = require('../models/User');
const Submission = require('../models/Submission');

// Badge tiers matching your Flutter kBadgeDefinitions
const BADGE_TIERS = [
    { tier: 'newCurator', minWins: 0, nextWins: 1, name: 'New Curator', shortLabel: 'New' },
    { tier: 'bronze', minWins: 1, nextWins: 5, name: 'Bronze Curator', shortLabel: 'Bronze' },
    { tier: 'silver', minWins: 5, nextWins: 10, name: 'Silver Curator', shortLabel: 'Silver' },
    { tier: 'gold', minWins: 10, nextWins: 20, name: 'Gold Master', shortLabel: 'Gold' },
    { tier: 'master', minWins: 20, nextWins: null, name: 'Master Curator', shortLabel: 'Master' },
];

const tierRank = {
    newCurator: 0,
    bronze: 1,
    silver: 2,
    gold: 3,
    master: 4
};

/**
 * Calculate user stats for badge determination (COMPLEX FORMULA)
 */
const calculateUserStats = async (userId) => {
    const submissions = await Submission.countDocuments({
        userId,
        status: { $in: ['approved', 'submitted', 'winner', 'shortlisted'] }
    });

    const user = await User.findById(userId)
        .select('wins streakDays followersCount')
        .lean();

    return {
        submissions,
        wins: user?.wins || 0,
        streakDays: user?.streakDays || 0,
        followers: user?.followersCount || 0
    };
};

/**
 * Determine badge tier using COMPLEX FORMULA (matches your existing logic)
 */
const determineTier = (stats) => {
    const { submissions, wins, followers, streakDays } = stats;

    // Master tier: requires manual admin review (don't auto-promote)
    if (
        submissions >= 50 && wins >= 15 &&
        followers >= 2000 && streakDays >= 180
    ) return 'gold'; // Cap at gold, master requires manual approval

    // Gold tier
    if (submissions >= 25 && wins >= 5 && followers >= 500 && streakDays >= 90)
        return 'gold';

    // Silver tier
    if (submissions >= 10 && streakDays >= 30)
        return 'silver';

    // Bronze tier
    if (submissions >= 3 || wins >= 1)
        return 'bronze';

    return 'newCurator';
};

/**
 * Get badge definition by tier name
 */
function getBadgeDefinition(tier) {
    return BADGE_TIERS.find(b => b.tier === tier) || BADGE_TIERS[0];
}

/**
 * Calculate badge progress info for API response (COMPLEX FORMULA)
 * @param {Object} stats - User stats from calculateUserStats
 * @returns {Object} Complete badge info for frontend
 */
function getBadgeApiResponse(stats) {
    const currentTier = determineTier(stats);
    const currentBadge = getBadgeDefinition(currentTier);

    // For complex formula, "wins to next" is estimated based on current wins
    // (since actual upgrade depends on multiple factors)
    let winsToNext = null;
    let progress = 1;

    if (currentBadge.nextWins !== null) {
        // Estimate wins needed based on current wins only (simplified for UI)
        winsToNext = Math.max(0, currentBadge.nextWins - (stats.wins || 0));

        // Calculate progress based on wins ratio (simplified visualization)
        const range = currentBadge.nextWins - currentBadge.minWins;
        progress = range > 0
            ? Math.min(1, Math.max(0, (stats.wins - currentBadge.minWins) / range))
            : 1;
    }

    // Generate motivation text (you can customize this logic)
    const motivation = currentBadge.nextWins === null
        ? `You are a ${currentBadge.name}. Keep inspiring the community with your curated shots!`
        : winsToNext === 1
            ? `You are 1 win away from achieving the ${currentBadge.shortLabel} Curator badge!`
            : `Win ${winsToNext} more contests to unlock the ${currentBadge.shortLabel} Curator badge.`;

    return {
        tier: currentTier,
        name: currentBadge.name,
        shortLabel: currentBadge.shortLabel,
        minWins: currentBadge.minWins,
        nextWins: currentBadge.nextWins,
        winsToNext: winsToNext,
        progress: Math.round(progress * 100) / 100, // 2 decimal places
        isMaxTier: currentBadge.nextWins === null,
        motivation: motivation,
        // For Flutter badge UI (matches your BadgeDefinition)
        icon: _getIconForTier(currentTier),
        colors: _getColorsForTier(currentTier),
        // Complex formula stats (for Flutter to display or calculate locally)
        stats: {
            submissions: stats.submissions,
            wins: stats.wins,
            streakDays: stats.streakDays,
            followers: stats.followers
        }
    };
}

/**
 * Helper: Get Cupertino icon name for tier (Flutter will map to IconData)
 */
function _getIconForTier(tier) {
    const icons = {
        newCurator: 'sparkles',
        bronze: 'flame_fill',
        silver: 'shield_fill',
        gold: 'star_fill',
        master: 'rosette'
    };
    return icons[tier] || 'sparkles';
}

/**
 * Helper: Get gradient colors for tier (matches Flutter BadgeDefinition)
 */
function _getColorsForTier(tier) {
    const colors = {
        newCurator: { start: '#0F172A', end: '#1F2937' },
        bronze: { start: '#B45309', end: '#92400E' },
        silver: { start: '#E5E7EB', end: '#6B7280' },
        gold: { start: '#FACC15', end: '#F97316' },
        master: { start: '#EC4899', end: '#8B5CF6' }
    };
    return colors[tier] || colors.newCurator;
}

/**
 * Check and upgrade user badge using COMPLEX FORMULA
 * Call this AFTER incrementing user.wins or other stats
 * @param {string} userId - User ID
 * @param {Object} userDoc - Optional: pre-fetched User document
 * @returns {Promise<Object>} Upgrade result
 */
const checkAndUpgradeBadge = async (userId, userDoc = null) => {
    const user = userDoc || await User.findById(userId);

    if (!user) {
        return { success: false, error: 'User not found' };
    }

    // Calculate stats using complex formula
    const stats = await calculateUserStats(userId);
    const oldTier = user.badgeTier || 'newCurator';
    const newTier = determineTier(stats);

    // Only upgrade if tier actually improved
    if (tierRank[newTier] > tierRank[oldTier]) {
        user.badgeTier = newTier;
        await user.save();

        console.log(`✅ User ${userId} upgraded: ${oldTier} → ${newTier} (complex formula)`);

        // TODO: Send push notification here (optional)
        // await sendBadgeUpgradeNotification(userId, newTier);

        return {
            success: true,
            upgraded: true,
            oldTier,
            newTier,
            stats,
            badgeInfo: getBadgeApiResponse(stats)
        };
    }

    return {
        success: true,
        upgraded: false,
        currentTier: newTier,
        stats,
        badgeInfo: getBadgeApiResponse(stats)
    };
};

/**
 * Get current badge tier for a user (for profile/home endpoints)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Badge info
 */
const getUserBadgeInfo = async (userId) => {
    const stats = await calculateUserStats(userId);
    return getBadgeApiResponse(stats);
};

module.exports = {
    calculateUserStats,
    determineTier,
    getBadgeDefinition,
    getBadgeApiResponse,
    getUserBadgeInfo,
    checkAndUpgradeBadge,
    BADGE_TIERS,
    tierRank
};