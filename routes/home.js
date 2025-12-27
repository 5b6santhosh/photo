
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const FileMeta = require('../models/FileMeta');
const Contest = require('../models/Contest');
const Like = require('../models/Like');
const Submission = require('../models/Submission');

// Helper function to format time labels
function formatTimeLabel(startDate, endDate) {
    const now = new Date();
    if (now < startDate) {
        const diffDays = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));
        return diffDays === 1 ? 'Starts tomorrow' : `Starts in ${diffDays} days`;
    } else if (now < endDate) {
        const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        return diffDays === 0 ? 'Ends today' : diffDays === 1 ? 'Ends tomorrow' : `Ends in ${diffDays} days`;
    } else {
        const diffDays = Math.floor((now - endDate) / (1000 * 60 * 60 * 24));
        return diffDays === 0 ? 'Ended today' : diffDays === 1 ? 'Ended 1 day ago' : `Ended ${diffDays} days ago`;
    }
}

// Helper function to map contest data
function mapContest(contest, userId, photoMap, submissionStats) {
    const now = new Date();
    const startDate = new Date(contest.startDate);
    const endDate = new Date(contest.endDate);

    let status;
    if (now < startDate) status = 'upcoming';
    else if (now < endDate) status = 'active';
    else status = 'completed';

    const isActive = status === 'active';
    const isUpcoming = status === 'upcoming';
    const isCompleted = status === 'completed';

    // Handle submissions
    const stats = submissionStats[contest._id.toString()] || { total: 0, myCount: 0 };


    // Map highlight photos
    const highlightPhotos = (contest.highlightPhotos || []).map(id => {
        const p = photoMap[id.toString()];
        return {
            id: id.toString(),
            title: p?.title || 'Untitled',
            location: p?.location || '',
            date: p?.uploadedAt ? new Date(p.uploadedAt) : endDate,
            peopleCount: p?.peopleCount || 0,
            category: p?.category || 'other',
            isFavorite: false
        };
    });

    return {
        id: contest._id.toString(),
        title: contest.title,
        subtitle: contest.subtitle || '',
        status,
        isActive,
        isUpcoming,
        isCompleted,
        prizeText: contest.prizeText || 'No prize',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        timeLabel: formatTimeLabel(startDate, endDate),
        totalSubmissions: stats.total,
        mySubmissions: stats.myCount,
        highlightPhotos
    };
}

// Public home feed — works with or without auth
// router.get('/', async (req, res) => {
//     try {
//         // Safely get userId if authenticated
//         const userId = req.user?.id || null;

//         // 1. Get user wins (if logged in)
//         let userWins = 0;
//         if (userId) {
//             const user = await User.findById(userId).select('wins').lean();
//             userWins = user?.wins || 0;
//         }

//         // 2. Fetch all contests (NO populate on submissions)
//         const contests = await Contest.find().sort({ startDate: 1 }).lean();
//         const contestIds = contests.map(c => c._id);

//         // 3. Fetch all submissions for these contests
//         let allSubmissions = [];
//         if (contestIds.length > 0) {
//             allSubmissions = await Submission.find({
//                 contestId: { $in: contestIds }
//             }).select('contestId userId').lean();
//         }

//         // 4. Build submission stats: { [contestId]: { total, myCount } }
//         const submissionStats = {};
//         contestIds.forEach(id => {
//             submissionStats[id.toString()] = { total: 0, myCount: 0 };
//         });

//         allSubmissions.forEach(sub => {
//             const cid = sub.contestId.toString();
//             if (submissionStats[cid]) {
//                 submissionStats[cid].total += 1;
//                 if (userId && sub.userId?.toString() === userId) {
//                     submissionStats[cid].myCount += 1;
//                 }
//             }
//         });


//         // 3. Pre-fetch highlight photos
//         const allHighlightIds = contests.flatMap(c =>
//             (c.highlightPhotos || []).filter(id => id)
//         );
//         const uniqueHighlightIds = [...new Set(allHighlightIds.map(id => id.toString()))];

//         const photoMap = {};
//         if (uniqueHighlightIds.length > 0) {
//             const photos = await FileMeta.find({
//                 _id: { $in: uniqueHighlightIds }
//             }).lean();
//             photos.forEach(p => {
//                 photoMap[p._id.toString()] = p;
//             });
//         }

//         // 4. Map all events
//         const events = contests.map(c => mapContest(c, userId, photoMap, submissionStats));

//         // 5. Determine hero event
//         let heroEvent = events.find(e => e.isActive) ||
//             events.find(e => e.isUpcoming) ||
//             events[0] || {};

//         // 6. Top curators
//         const topCurators = await User.find({ wins: { $gte: 3 } })
//             .sort({ wins: -1 })
//             .limit(12)
//             .select('name avatarUrl wins')
//             .lean();

//         // 7. Trending photos
//         const photos = await FileMeta.find({
//             archived: false,
//             visibility: 'public'
//         })
//             .sort({ likesCount: -1, uploadedAt: -1 })
//             .limit(20)
//             .lean();

//         const trendingPhotos = await Promise.all(photos.map(async (p) => {
//             let isLiked = false;
//             if (userId) {
//                 isLiked = !!(await Like.exists({
//                     fileId: p._id,
//                     userId
//                 }));
//             }
//             return {
//                 id: p._id.toString(),
//                 imageUrl: p.path, //  Use cloud URL directly (from FileMeta.path)
//                 userName: p.createdByName || 'Curator',
//                 isCurated: p.isCurated || false,
//                 likes: p.likesCount || 0,
//                 isLiked
//             };
//         }));

//         res.json({
//             userWins,
//             heroEvent,
//             topCurators,
//             events,
//             trendingPhotos
//         });

//     } catch (err) {
//         console.error('HOME API ERROR:', err);
//         res.status(500).json({ message: 'Home feed failed' });
//     }
// });

router.get('/', (req, res) => {
  res.json({ message: 'Home API is working!' });
});

module.exports = router;