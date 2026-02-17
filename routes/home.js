// routes/home.js
const express = require('express');
const mongoose = require('mongoose'); // Imported for ObjectId validation
const router = express.Router();
const User = require('../models/User');
const FileMeta = require('../models/FileMeta');
const Contest = require('../models/Contest');
const Submission = require('../models/Submission');

const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};

function formatHighlightPhoto(photo, contestEndDate) {
    if (!photo) return null;

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
        isFavorite: false,
        aspectRatio: photo.aspectRatio || 9 / 16,
        blurHash: photo.blurHash || null,
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

    const stats = submissionStats[contest._id.toString()] || { total: 0, myCount: 0 };

    const highlightPhotos = (contest.highlightPhotos || [])
        .map(id => {
            const photo = photoMap[id.toString()];
            return photo ? formatHighlightPhoto(photo, endDate) : null;
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
            }
        }

        // 5. Map contests
        const events = contests.map(c => mapContest(c, userId, photoMap, submissionStats));

        // 6. Hero event
        const heroEvent = events.find(e => e.isActive) ||
            events.find(e => e.isUpcoming) ||
            events[0] || null;

        // 7. Top curators
        const topCurators = await User.find({ wins: { $gte: 3 } })
            .sort({ wins: -1 })
            .limit(12)
            .select('name avatarUrl wins')
            .lean();

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

        res.json({
            success: true,
            data: {
                userWins,
                heroEvent,
                topCurators: topCurators.map(c => ({
                    id: c._id.toString(),
                    name: c.name,
                    avatarUrl: c.avatarUrl,
                    wins: c.wins,
                })),
                events,
                trendingPhotos,
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