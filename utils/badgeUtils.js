const User = require('../models/User');
const Submission = require('../models/Submission');

const tierRank = {
    newCurator: 0,
    bronze: 1,
    silver: 2,
    gold: 3,
    master: 4
};

const determineTier = (stats) => {
    const { submissions, wins, followers, streakDays } = stats;

    if (
        submissions >= 50 && wins >= 15 &&
        followers >= 2000 && streakDays >= 180
        // master also needs manual admin review — handle separately
    ) return 'gold'; // don't auto-promote to master

    if (submissions >= 25 && wins >= 5 && followers >= 500 && streakDays >= 90)
        return 'gold';

    if (submissions >= 10 && streakDays >= 30) // add acceptance rate check if you track it
        return 'silver';

    if (submissions >= 3 || wins >= 1)
        return 'bronze';

    return 'newCurator';
};

const calculateUserStats = async (userId) => {
    const submissions = await Submission.countDocuments({ userId, status: { $in: ['approved', 'submitted'] } });
    const user = await User.findById(userId).select('wins streakDays followersCount').lean();

    return {
        submissions,
        wins: user.wins || 0,
        streakDays: user.streakDays || 0,
        followers: user.followersCount || 0
    };
};

const checkAndUpgradeBadge = async (userId) => {
    const user = await User.findById(userId);
    const stats = await calculateUserStats(userId);
    const newTier = determineTier(stats);

    if (tierRank[newTier] > tierRank[user.badgeTier || 'newCurator']) {
        user.badgeTier = newTier;
        await user.save();
        console.log(`✅ User ${userId} upgraded to ${newTier}`);
        // TODO: Send push notification here
    }
};

module.exports = { checkAndUpgradeBadge };