// const express = require('express');
// const router = express.Router();

// const FileMeta = require('../models/FileMeta');
// const Contest = require('../models/Contest');
// const Like = require('../models/Like');
// const User = require('../models/User');

// const auth = require('../middleware/auth'); // JWT middleware

// /**
//  * GET /api/home
//  * Main Home Screen API
//  */
// router.get('/',
//     auth,
//     async (req, res) => {
//         try {
//             // const userId = req.user.id;
//             const userId = req.user?.id || '657890abcdef123456789012'; // temporary fallback

//             /* ---------------- HERO EVENT ---------------- */
//             const heroEvent = await Contest.findOne({ isActive: true })
//                 .sort({ createdAt: -1 })
//                 .lean();

//             /* ---------------- TOP CURATORS ---------------- */
//             const topCurators = await User.find({ wins: { $gte: 3 } })
//                 .sort({ wins: -1 })
//                 .limit(10)
//                 .select('name avatarUrl wins')
//                 .lean();

//             /* ---------------- TRENDING PHOTOS ---------------- */
//             const photos = await FileMeta.find({ archived: false })
//                 .sort({ uploadedAt: -1 })
//                 .limit(20)
//                 .lean();

//             const trendingPhotos = await Promise.all(
//                 photos.map(async (p) => {
//                     const likes = await Like.countDocuments({ fileId: p._id });
//                     const isLiked = await Like.exists({
//                         fileId: p._id,
//                         userId,
//                     });

//                     return {
//                         id: p._id,
//                         imageUrl: `${process.env.BASE_URL}/uploads/${p.fileName}`,
//                         userName: p.createdByName,
//                         isCurated: p.isCurated,
//                         likes,
//                         isLiked: !!isLiked,
//                     };
//                 })
//             );

//             /* ---------------- ACTIVE CONTESTS ---------------- */
//             const contests = await Contest.find({})
//                 .sort({ endDate: 1 })
//                 .lean();

//             const activeContests = contests.map((c) => ({
//                 id: c._id,
//                 title: c.title,
//                 subtitle: c.subtitle,
//                 status: c.status, // active | upcoming | completed
//                 prizeText: c.prizeText,
//                 startDate: c.startDate,
//                 endDate: c.endDate,
//                 totalSubmissions: c.totalSubmissions,
//                 mySubmissions: c.submissions.filter(
//                     (s) => s.userId.toString() === userId
//                 ).length,
//                 highlightPhotos: c.highlightPhotos || [],
//             }));

//             res.json({
//                 heroEvent,
//                 topCurators,
//                 trendingPhotos,
//                 activeContests,
//             });
//         } catch (err) {
//             console.error(err);
//             res.status(500).json({ message: 'Home feed failed' });
//         }
//     });

// module.exports = router;


const express = require('express');
const router = express.Router();

const FileMeta = require('../models/FileMeta');
const Contest = require('../models/Contest');
const Like = require('../models/Like');
const User = require('../models/User');

const auth = require('../middleware/auth');

/**
 * GET /api/home
 * Full Home Feed API (Flutter HomeScreen)
 */
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        /* =====================================================
           1️⃣ HERO FEATURED EVENT (Active → Upcoming fallback)
        ====================================================== */
        let heroEvent = await Contest.findOne({ status: 'active' })
            .sort({ startDate: 1 })
            .lean();

        if (!heroEvent) {
            heroEvent = await Contest.findOne({ status: 'upcoming' })
                .sort({ startDate: 1 })
                .lean();
        }

        const heroEventPayload = heroEvent
            ? mapContest(heroEvent, userId, true)
            : null;

        /* =====================================================
           2️⃣ MEET THE MASTERS (Silver+ Curators)
        ====================================================== */
        const topCurators = await User.find({ wins: { $gte: 3 } })
            .sort({ wins: -1 })
            .limit(12)
            .select('name avatarUrl wins')
            .lean();

        /* =====================================================
           3️⃣ TRENDING PHOTOS (Reels feed)
        ====================================================== */
        const photos = await FileMeta.find({
            archived: false,
            visibility: 'public',
        })
            .sort({ likesCount: -1, uploadedAt: -1 })
            .limit(20)
            .lean();

        const trendingPhotos = await Promise.all(
            photos.map(async (p) => {
                const isLiked = await Like.exists({
                    fileId: p._id,
                    userId,
                });

                return {
                    id: p._id,
                    imageUrl: `${process.env.BASE_URL}/uploads/${p.fileName}`,
                    userName: p.createdByName || 'Curator',
                    isCurated: p.isCurated === true,
                    likes: p.likesCount || 0,
                    isLiked: !!isLiked,
                };
            })
        );

        /* =====================================================
           4️⃣ EVENTS LIST (All states)
        ====================================================== */
        const contests = await Contest.find({})
            .sort({ startDate: 1 })
            .lean();

        const events = contests.map((c) => mapContest(c, userId));

        /* =====================================================
           5️⃣ RESPONSE (STRICT CONTRACT)
        ====================================================== */
        res.json({
            heroEvent: heroEventPayload,
            topCurators,
            trendingPhotos,
            events,
        });
    } catch (err) {
        console.error('HOME API ERROR:', err);
        res.status(500).json({ message: 'Home feed failed' });
    }
});

module.exports = router;

/* =====================================================
   Helpers
===================================================== */

function mapContest(contest, userId, isHero = false) {
    const now = new Date();

    let status = contest.status;
    if (!status) {
        if (contest.startDate > now) status = 'upcoming';
        else if (contest.endDate < now) status = 'completed';
        else status = 'active';
    }

    const submissions = contest.submissions || [];
    const mySubmissions = submissions.filter(
        (s) => s.userId?.toString() === userId
    ).length;

    return {
        id: contest._id,
        title: contest.title,
        subtitle: contest.subtitle,
        status, // active | upcoming | completed
        prizeText: contest.prizeText,
        startDate: contest.startDate,
        endDate: contest.endDate,
        totalSubmissions: submissions.length,
        mySubmissions,
        highlightPhotos: contest.highlightPhotos || [],
        isHero,
    };
}


