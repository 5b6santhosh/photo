// routes/home.js
const express = require('express');
const mongoose = require('mongoose'); // Imported for ObjectId validation
const router = express.Router();
const User = require('../models/User');
const FileMeta = require('../models/FileMeta');
const Contest = require('../models/Contest');
const Submission = require('../models/Submission');
const { getUserBadgeInfo } = require('../utils/badgeUtils');
const JudgeDecision = require('../models/JudgeDecision');

const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

function formatHighlightPhoto(photo, contestEndDate, options = {}) {
    if (!photo) return null;

    const {
        isCurated = photo.isCurated || false,
        userName = photo.userName || null,
        isLiked = photo.isLiked || false,
        isFavorite = photo.isFavorite || false
    } = options;

    return {
        id: photo._id.toString(),
        url: photo.path || photo.url || '',
        thumbnailUrl: photo.thumbnailPath || photo.thumbnailUrl || photo.path || '',
        title: photo.title || 'Untitled',
        subtitle: photo.subtitle || photo.description || '',
        location: photo.location || '',
        date: photo.uploadedAt ? new Date(photo.uploadedAt).toISOString() : new Date(contestEndDate).toISOString(),
        peopleCount: photo.peopleCount || 0,
        category: photo.category || 'other',
        likesCount: photo.likesCount || 0,
        isFavorite: isFavorite,
        aspectRatio: photo.aspectRatio || 9 / 16,
        blurHash: photo.blurHash || null,
        userName: userName,
        isCurated: isCurated,
        isLiked: isLiked,
    };
}


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

function mapContest(contest, userId, photoMap, submissionStats, userMap = {}) {
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

    const stats = submissionStats[contest._id.toString()] || { total: 0, myCount: 0 };

    const highlightPhotos = (contest.highlightPhotos || [])
        .map(id => {
            const photo = photoMap[id.toString()];
            if (!photo) return null;

            // Get username from userMap if available (for curated photos)
            const photoUserName = userMap[photo.createdBy?.toString()] || null;

            return formatHighlightPhoto(photo, endDate, {
                isCurated: true, // Highlight photos are curated
                userName: photoUserName,
                isLiked: false // You can implement like checking here if needed
            });
        })
        .filter(p => p !== null);

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
        highlightPhotos,
        coverImage: highlightPhotos.length > 0 ? highlightPhotos[0].url : null,
    };
}

router.get('/', async (req, res) => {
    try {
        const rawUserId = req.user?.id || null;
        const userId = (rawUserId && isValidObjectId(rawUserId)) ? rawUserId : null;
        const userMap = {};

        // 1. User wins
        let userWins = 0;
        if (userId) {
            const user = await User.findById(userId).select('wins').lean();
            userWins = user?.wins || 0;
        }

        // 2. All contests
        const contests = await Contest.find()
            .sort({ startDate: -1 })
            .lean();
        const contestIds = contests.map(c => c._id);

        // 3. Submissions aggregation
        const submissionStats = {};
        contestIds.forEach(id => {
            submissionStats[id.toString()] = { total: 0, myCount: 0 };
        });

        if (contestIds.length > 0) {
            const submissions = await Submission.find({
                contestId: { $in: contestIds }
            }).select('contestId userId').lean();

            submissions.forEach(sub => {
                const cid = sub.contestId.toString();
                if (submissionStats[cid]) {
                    submissionStats[cid].total += 1;
                    if (userId && sub.userId?.toString() === userId) {
                        submissionStats[cid].myCount += 1;
                    }
                }
            });
        }

        // 4. Pre-fetch highlight photos
        const allHighlightIds = contests.flatMap(c =>
            (c.highlightPhotos || []).filter(id => id)
        );
        const uniqueHighlightIds = [...new Set(allHighlightIds.map(id => id.toString()))];

        const photoMap = {};
        if (uniqueHighlightIds.length > 0) {
            const validHighlightIds = uniqueHighlightIds.filter(id => isValidObjectId(id));

            if (validHighlightIds.length > 0) {
                const photos = await FileMeta.find({
                    _id: { $in: validHighlightIds }
                })
                    .select('_id path thumbnailPath title subtitle description location uploadedAt peopleCount category likesCount aspectRatio blurHash')
                    .lean();

                photos.forEach(p => {
                    photoMap[p._id.toString()] = p;
                });
                const creatorIds = [...new Set(photos
                    .map(p => p.createdBy?.toString())
                    .filter(id => id && isValidObjectId(id))
                )];

                if (creatorIds.length > 0) {
                    const creators = await User.find({
                        _id: { $in: creatorIds }
                    }).select('name').lean();

                    creators.forEach(c => {
                        userMap[c._id.toString()] = c.name;
                    });
                }

            }
        }

        // 5. Map contests
        const events = contests.map(c => mapContest(c, userId, photoMap, submissionStats, userMap));

        // 6. Hero event
        const heroEvent = events.find(e => e.isActive) ||
            events.find(e => e.isUpcoming) ||
            events[0] || null;

        // 7. Top curators
        const topCuratorsRaw = await User.find({ wins: { $gte: 3 } })
            .sort({ wins: -1 })
            .limit(12)
            .select('name avatarUrl wins')
            .lean();

        // Resolve all async badge requests in parallel safely
        const topCurators = await Promise.all(
            topCuratorsRaw.map(async (c) => ({
                id: c._id.toString(),
                name: c.name,
                avatarUrl: c.avatarUrl,
                wins: c.wins,
                badge: await getUserBadgeInfo(c._id.toString())
            }))
        );
        // 8. Trending photos
        const trendingPhotosRaw = await FileMeta.find({
            archived: false,
            visibility: 'public'
        })
            .sort({ likesCount: -1, uploadedAt: -1 })
            .limit(20)
            .select('_id path thumbnailPath title location uploadedAt likesCount category createdBy')
            .lean();

        const rawCreatorIds = trendingPhotosRaw.map(p => p.createdBy?.toString()).filter(Boolean);
        const creatorIds = [...new Set(rawCreatorIds.filter(id => isValidObjectId(id)))];

        const creators = await User.find({ _id: { $in: creatorIds } }).select('name').lean();
        const creatorMap = {};
        creators.forEach(c => creatorMap[c._id.toString()] = c.name);

        const trendingPhotos = trendingPhotosRaw.map(p => ({
            ...formatHighlightPhoto(p, new Date()),
            userName: creatorMap[p.createdBy?.toString()] || 'Anonymous',
            isCurated: p.isCurated || false,
            isLiked: false,
        }));
        const userBadge = userId ? await getUserBadgeInfo(userId) : null;

        let winnersResponse = { winners: [] };

        try {
            const latestContestWithWinners = await Contest.findOne({
                contestStatus: 'completed'
            })
                .sort({ endDate: -1 })
                .select('_id title')
                .lean();

            if (latestContestWithWinners) {
                const judgeDecisions = await JudgeDecision.find({
                    contestId: latestContestWithWinners._id,
                    finalDecision: 'winner'
                })
                    .populate('entryId', 'title')
                    .populate('userId', 'name avatarUrl')
                    .sort({ position: 1 })
                    .limit(3)
                    .lean();

                winnersResponse = {
                    contestId: latestContestWithWinners._id.toString(),
                    contestTitle: latestContestWithWinners.title,
                    winners: judgeDecisions.map((decision, index) => ({
                        rank: decision.position || (index + 1),
                        entryId: {
                            id: decision.entryId?._id?.toString() || null,
                            title: decision.entryId?.title || 'Untitled',
                        },
                        userId: {
                            id: decision.userId?._id?.toString() || null,
                            name: decision.userId?.name || 'Anonymous',
                            avatarUrl: decision.userId?.avatarUrl || null,
                        },
                        aiScore: decision.aiScore || null,
                        aiRank: decision.aiRank || null,
                    }))
                };
            }
        } catch (winnersErr) {
            console.error('Failed to fetch winners for home banner:', winnersErr);
        }

        res.json({
            success: true,
            data: {
                userWins,
                userBadge: userBadge,
                heroEvent,
                topCurators,
                events,
                trendingPhotos,
                winnersResponse: winnersResponse,
            }
        });

    } catch (err) {
        console.error('HOME API ERROR:', err);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Home feed failed',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    }
});

module.exports = router;