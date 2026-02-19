
// routes/contestDetails.js (or add to your existing contest routes)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Contest = require('../models/Contest');
const ContestEntry = require('../models/ContestEntry');
const Payment = require('../models/Payment');
const FileMeta = require('../models/FileMeta');
const { authMiddleware: authMiddleware } = require('../middleware/auth');
const Submission = require('../models/Submission');
const JudgeDecision = require('../models/JudgeDecision');

function formatHighlightPhoto(photo, contestEndDate) {
    if (!photo) return null;

    return {
        id: photo._id?.toString() || photo.id?.toString() || '',
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

router.get('/:contestId/details', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user?.id || null;
        console.log('Contest details request:', { contestId, userId: userId || 'anonymous' });

        // Validate contestId
        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid contest ID'
            });
        }

        // Fetch contest with highlight photos populated
        const contest = await Contest.findById(contestId).lean();

        if (!contest) {
            return res.status(404).json({
                success: false,
                message: 'Contest not found'
            });
        }

        // Fetch actual photo documents for highlights
        let highlightPhotos = [];
        if (contest.highlightPhotos?.length > 0) {
            const photos = await FileMeta.find({
                _id: { $in: contest.highlightPhotos }
            })
                .select('_id path thumbnailPath title subtitle description location uploadedAt peopleCount category likesCount aspectRatio blurHash')
                .lean();

            // Maintain order from contest.highlightPhotos array
            const photoMap = {};
            photos.forEach(p => photoMap[p._id.toString()] = p);

            highlightPhotos = contest.highlightPhotos
                .map(id => formatHighlightPhoto(photoMap[id.toString()], contest.endDate))
                .filter(p => p !== null);
        }

        // 2. FETCH USER'S SUBMISSIONS FOR THIS CONTEST (What they actually submitted)
        let userSubmissions = [];
        let contestEntry = null;

        if (userId) {
            // Try ContestEntry first (your current model)
            const entry = await ContestEntry.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                contestId: new mongoose.Types.ObjectId(contestId)
            }).lean();

            if (entry) {
                contestEntry = {
                    id: entry._id.toString(),
                    status: entry.status,
                    submittedAt: entry.submittedAt,
                    photos: entry.photos || [],
                    videos: entry.videos || [],
                };

                // Fetch actual photo documents for user's submission
                if (entry.photos?.length > 0) {
                    const photoDocs = await FileMeta.find({
                        _id: { $in: entry.photos }
                    }).lean();

                    userSubmissions = photoDocs.map(p => formatHighlightPhoto(p, contest.endDate));
                }
            }

            // Also check Submission model (used in home route)
            const submission = await Submission.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                contestId: new mongoose.Types.ObjectId(contestId)
            }).lean();

            if (submission && !contestEntry) {
                contestEntry = {
                    id: submission._id.toString(),
                    status: submission.status || 'submitted',
                    submittedAt: submission.createdAt || submission.submittedAt,
                    photos: submission.photos || [submission.fileId].filter(Boolean),
                    videos: submission.videos || [],
                };
            }
        }

        // Payment status (only if authenticated)
        let paymentStatus = null;
        if (userId) {
            const payment = await Payment.findOne({
                userId,
                contestId,
                status: { $in: ['pending', 'verified', 'completed'] }
            }).sort({ createdAt: -1 }).lean();

            if (payment) {
                paymentStatus = {
                    status: payment.status,
                    paymentId: payment.paymentId,
                    orderId: payment.orderId,
                    amount: payment.amount,
                    currency: payment.currency,
                    paidAt: payment.verifiedAt || payment.createdAt,
                };
            }
        }

        // // User's entry (only if authenticated)
        // if (userId) {
        //     const entry = await ContestEntry.findOne({ userId, contestId }).lean();
        //     if (entry) {
        //         contestEntry = {
        //             id: entry._id.toString(),
        //             status: entry.status,
        //             submittedAt: entry.submittedAt,
        //             photos: entry.photos || [],
        //             videos: entry.videos || [],
        //         };
        //     }
        // }
        // 4. STATS - Count from BOTH models to be safe
        const entryCount = await ContestEntry.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId),
            status: { $in: ['submitted', 'approved', 'rejected', 'pending'] }
        });

        const submissionCount = await Submission.countDocuments({
            contestId: new mongoose.Types.ObjectId(contestId)
        });


        // Stats
        const totalSubmissions = Math.max(entryCount, submissionCount) || (entryCount + submissionCount);

        const mySubmissions = userId ? await ContestEntry.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
            contestId: new mongoose.Types.ObjectId(contestId),
            status: { $in: ['submitted', 'approved', 'rejected', 'pending'] }
        }) : 0;

        // Status calculation - PRIORITIZE DATES over isOpenForSubmissions for timeLabel consistency
        const now = new Date();
        const startDate = new Date(contest.startDate);
        const endDate = new Date(contest.endDate);

        // Date-based status (what users see)
        const dateBasedIsUpcoming = now < startDate;
        const dateBasedIsCompleted = now > endDate;
        const dateBasedIsActive = !dateBasedIsUpcoming && !dateBasedIsCompleted;

        // Functional status (can they actually submit?)
        const isOpenForSubmissions = ['published', 'ongoing'].includes(contest.contestStatus) && dateBasedIsActive;
        const isActive = dateBasedIsActive && isOpenForSubmissions;
        const isUpcoming = dateBasedIsUpcoming;
        const isCompleted = dateBasedIsCompleted || (dateBasedIsActive && !isOpenForSubmissions);

        // Time label - ALWAYS based on dates, not submission status
        let timeLabel = '';
        let timeStatus = ''; // 'upcoming', 'active', 'completed' for UI styling

        if (dateBasedIsUpcoming) {
            const daysUntil = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysUntil === 1 ? 'Starts in 1 day' : `Starts in ${daysUntil} days`;
            timeStatus = 'upcoming';
        } else if (dateBasedIsActive) {
            const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysLeft === 0 ? 'Ends today' : daysLeft === 1 ? 'Ends in 1 day' : `Ends in ${daysLeft} days`;
            timeStatus = 'active';
        } else {
            const daysAgo = Math.floor((now - endDate) / (1000 * 60 * 60 * 24));
            timeLabel = daysAgo === 0 ? 'Ended today' : daysAgo === 1 ? 'Ended 1 day ago' : `Ended ${daysAgo} days ago`;
            timeStatus = 'completed';
        }

        // Override if submissions are closed but contest is date-active
        // let displayStatus = timeStatus;
        // let statusBadge = isActive ? 'Active' : (isUpcoming ? 'Upcoming' : 'Completed');

        // // If date says active but submissions are closed, show "Ending Soon" or keep date-based label
        // if (dateBasedIsActive && !isOpenForSubmissions) {
        //     statusBadge = 'Closing Soon';
        // }
        console.log('Sending response:', {
            userId,
            totalSubmissions,
            mySubmissions,
            hasParticipated: !!contestEntry || mySubmissions > 0,
            highlightCount: highlightPhotos.length,
            userSubmissionCount: userSubmissions.length
        });

        res.json({
            success: true,
            data: {
                id: contest._id.toString(),
                title: contest.title,
                subtitle: contest.subtitle || contest.description,
                description: contest.description,
                prizeText: contest.prizeText || (contest.entryFee > 0 ? `₹${contest.entryFee}` : 'Free entry'),
                entryFee: contest.entryFee || 0,
                startDate: contest.startDate,
                endDate: contest.endDate,
                isActive,           // Can user submit?
                isUpcoming,         // Before start date?
                isCompleted,        // After end date or closed?
                isOpenForSubmissions, // Explicit flag
                timeLabel,          // Date-based label
                timeStatus,         // 'upcoming' | 'active' | 'completed'
                // displayStatus,      // For UI theming
                // statusBadge,        // Text for badge
                totalSubmissions,
                mySubmissions,
                highlightPhotos,
                userSubmissions,
                coverImage: highlightPhotos.length > 0 ? highlightPhotos[0].url :
                    (userSubmissions.length > 0 ? userSubmissions[0].url : null),
                contestEntry,
                paymentStatus,
                hasParticipated: !!contestEntry || mySubmissions > 0,
                category: contest.category,
                tags: contest.tags || [],
                rules: contest.rules,
                prizes: contest.prizes,
                createdAt: contest.createdAt,
                updatedAt: contest.updatedAt,
            }
        });

    } catch (err) {
        console.error('GET CONTEST DETAILS ERROR:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contest details',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});


// GET endpoint specifically for checking payment status
router.get('/:contestId/payment-status', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const payment = await Payment.findOne({
            userId,
            contestId,
            status: { $in: ['pending', 'verified'] }
        }).sort({ createdAt: -1 });

        if (!payment) {
            return res.json({
                status: 'not_found',
                message: 'No payment record found'
            });
        }

        res.json({
            status: payment.status,
            paymentId: payment.paymentId,
            orderId: payment.orderId,
            amount: payment.amount,
            currency: payment.currency,
            verifiedAt: payment.verifiedAt,
            createdAt: payment.createdAt
        });

    } catch (err) {
        console.error('GET PAYMENT STATUS ERROR:', err);
        res.status(500).json({
            message: 'Failed to fetch payment status',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});

// GET endpoint for checking contest entry status
router.get('/:contestId/entry-status', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contestEntry = await ContestEntry.findOne({
            userId,
            contestId
        });

        if (!contestEntry) {
            return res.json({
                status: 'not_submitted',
                message: 'No submission found'
            });
        }

        res.json({
            status: contestEntry.status,
            submittedAt: contestEntry.submittedAt,
            photos: contestEntry.photos,
            videos: contestEntry.videos,
            metadata: contestEntry.metadata,
            feedback: contestEntry.feedback
        });

    } catch (err) {
        console.error('GET ENTRY STATUS ERROR:', err);
        res.status(500).json({
            message: 'Failed to fetch entry status',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});

// POST endpoint to submit photos/videos to contest
router.post('/:contestId/submit', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;
        const { photos, videos, metadata } = req.body;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        // Validate that at least one photo or video is provided
        if ((!photos || photos.length === 0) && (!videos || videos.length === 0)) {
            return res.status(400).json({
                message: 'At least one photo or video is required'
            });
        }

        // Check if contest exists and is open
        const contest = await Contest.findById(contestId);
        if (!contest) {
            return res.status(404).json({ message: 'Contest not found' });
        }

        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({
                message: 'Contest is not open for submissions'
            });
        }

        // Check if already submitted
        const existingEntry = await ContestEntry.findOne({
            userId,
            contestId,
            status: { $in: ['submitted', 'approved'] }
        });

        if (existingEntry) {
            return res.status(400).json({
                message: 'You have already submitted to this contest',
                existingEntry: {
                    id: existingEntry._id,
                    status: existingEntry.status,
                    submittedAt: existingEntry.submittedAt
                }
            });
        }

        // If contest has entry fee, verify payment
        if (contest.entryFee && contest.entryFee > 0) {
            const payment = await Payment.findOne({
                userId,
                contestId,
                status: 'verified',
                used: false
            });

            if (!payment) {
                return res.status(402).json({
                    message: 'Payment required. Please complete payment first.',
                    entryFee: contest.entryFee
                });
            }

            // Mark payment as used
            payment.used = true;
            await payment.save();
        }

        // Create contest entry
        const contestEntry = await ContestEntry.create({
            userId,
            contestId,
            photos: photos || [],
            videos: videos || [],
            status: 'submitted',
            submittedAt: new Date(),
            metadata: metadata || {}
        });

        // Update contest submission count
        await Contest.findByIdAndUpdate(contestId, {
            $inc: { totalSubmissions: 1 }
        });

        res.status(201).json({
            message: 'Submission successful',
            entry: {
                id: contestEntry._id,
                status: contestEntry.status,
                submittedAt: contestEntry.submittedAt,
                photos: contestEntry.photos,
                videos: contestEntry.videos
            }
        });

    } catch (err) {
        console.error('SUBMIT CONTEST ENTRY ERROR:', err);
        res.status(500).json({
            message: 'Failed to submit entry',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
        });
    }
});

// NEW ROUTE: Add to routes/contest.js
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get all submissions by user with contest data
        const submissions = await Submission.find({ userId })
            .populate({
                path: 'contestId',
                populate: { path: 'rules', select: 'title description' }
            })
            .populate('fileId', 'thumbnailUrl path')
            .sort({ createdAt: -1 })
            .lean();

        // Group by contest to get unique contests user joined
        const contestMap = new Map();

        for (const sub of submissions) {
            const c = sub.contestId;
            if (!c) continue;

            const now = new Date();
            let status = 'upcoming';
            if (now >= c.startDate && now <= c.endDate) status = 'active';
            else if (now > c.endDate) status = 'completed';

            // Determine placement
            let placement = 'participant';
            if (sub.status === 'winner') placement = 'winner';
            else if (sub.status === 'shortlisted') placement = 'finalist';

            if (!contestMap.has(c._id.toString())) {
                contestMap.set(c._id.toString(), {
                    id: c._id,
                    title: c.rules?.title || c.title || 'Untitled Contest',
                    subtitle: c.rules?.description || c.description || '',
                    status,
                    myEntries: 0,
                    placement: 'participant', // Will upgrade if better found
                    endDate: c.endDate,
                    hasHighlights: status === 'completed', // Winners announced
                    submissions: []
                });
            }

            const entry = contestMap.get(c._id.toString());
            entry.myEntries++;
            entry.submissions.push({
                id: sub._id,
                status: sub.status,
                thumbnail: sub.fileId?.thumbnailUrl || sub.fileId?.path,
                verdict: sub.verdict
            });

            // Upgrade placement if this submission has better status
            if (placement === 'winner' ||
                (placement === 'finalist' && entry.placement === 'participant')) {
                entry.placement = placement;
            }
        }

        res.json({
            success: true,
            contests: Array.from(contestMap.values())
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// routes/contest.js - Add this route
router.get('/:contestId/overview', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        validateObjectId(contestId, 'contestId');

        const contest = await Contest.findById(contestId)
            .populate('rules', 'title description prizeDescription theme')
            .lean();

        if (!contest) {
            return res.status(404).json({ success: false, error: 'Contest not found' });
        }

        // Get user's submissions for this contest
        const mySubmissions = await Submission.find({
            contestId,
            userId
        })
            .populate('fileId', 'thumbnailUrl path title')
            .sort({ createdAt: -1 })
            .lean();

        // Get total entry count
        const totalEntries = await Submission.countDocuments({ contestId });

        // Determine user's placement
        const mySubmissionIds = mySubmissions.map(s => s._id.toString());
        const mySubmissionIdSet = new Set(mySubmissionIds);
        const judgeDecision = await JudgeDecision.findOne({
            contestId,
            entryId: { $in: mySubmissionIds },
            finalDecision: 'winner'
        }).lean();

        let placement = 'participant';
        let placementPosition = null;

        if (judgeDecision) {
            placement = judgeDecision.position === 1 ? 'winner' : 'finalist';
            placementPosition = judgeDecision.position;
        }

        // Check if results are visible (Phase 3)
        const now = new Date();
        const phase3Start = new Date(contest.endDate);
        phase3Start.setDate(phase3Start.getDate() + 2);
        const resultsVisible = now >= phase3Start;

        let highlights = [];
        if (resultsVisible) {
            const topEntries = await getTopEntriesForReview({ contestId, limit: 30 });
            highlights = await Promise.all(
                topEntries.qualified.slice(0, 10).map(async (e) => {
                    const sub = await Submission.findById(e.entryId)
                        .populate('fileId', 'thumbnailUrl')
                        .lean();

                    return {
                        entryId: e.entryId,
                        thumbnailUrl: sub?.fileId?.thumbnailUrl,
                        rank: e.preliminaryRank,
                        aiScore: e.scores.final,
                        isMyEntry: e.userId?.toString() === userId
                    };
                })
            );
        }

        // Build timeline based on user's journey
        const timeline = buildUserTimeline(mySubmissions, judgeDecision);

        // Calculate time label
        const timeLabel = calculateTimeLabel(contest, now);

        res.json({
            success: true,
            contest: {
                id: contest._id,
                title: contest.rules?.title || contest.title,
                subtitle: contest.rules?.description || '',
                prizeText: contest.rules?.prizeDescription || 'Win curated badge + spotlight',
                status: getContestStatus(contest, now),
                theme: contest.rules?.theme,

                // Stats
                totalEntries,
                myShots: mySubmissions.length,
                placement,
                placementPosition,

                // Dates
                startDate: contest.startDate,
                endDate: contest.endDate,
                phase3Start: phase3Start.toISOString(),
                resultsVisible,
                timeLabel,

                // User's submissions
                mySubmissions: mySubmissions.map(s => ({
                    id: s._id,
                    thumbnail: s.fileId?.thumbnailUrl,
                    status: s.status,
                    verdict: s.verdict,
                    aiScore: s.aiScore,
                    submittedAt: s.createdAt
                })),

                // Highlights for reel
                highlights,

                // Journey timeline
                timeline
            }
        });

    } catch (error) {
        console.error('Get contest details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function validateObjectId(id, fieldName = 'id') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid ${fieldName}: must be a valid MongoDB ObjectId`);
    }
}

// Helper functions
function getContestStatus(contest, now) {
    if (now < contest.startDate) return 'upcoming';
    if (now <= contest.endDate) return 'active';
    return 'completed';
}

function calculateTimeLabel(contest, now) {
    const end = new Date(contest.endDate);
    const diff = end - now;

    if (diff > 0) {
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        return days === 1 ? 'Ends tomorrow' : `${days} days left`;
    }

    const phase3 = new Date(end);
    phase3.setDate(phase3.getDate() + 2);
    const resultsDiff = phase3 - now;

    if (resultsDiff > 0) {
        const hours = Math.ceil(resultsDiff / (1000 * 60 * 60));
        return `Results in ${hours}h`;
    }

    return 'Results announced';
}

function buildUserTimeline(submissions, judgeDecision) {
    const timeline = [];

    if (submissions.length > 0) {
        timeline.push({
            step: 'joined',
            label: 'Joined contest',
            description: `You added your first shot on ${submissions[0].createdAt.toLocaleDateString()}`,
            completed: true,
            timestamp: submissions[0].createdAt
        });

        const shortlisted = submissions.filter(s => s.status === 'shortlisted' || s.status === 'winner');
        if (shortlisted.length > 0) {
            timeline.push({
                step: 'shortlisted',
                label: 'Curated in highlights',
                description: `${shortlisted.length} of your shots were shortlisted for the reel`,
                completed: true,
                timestamp: shortlisted[0].createdAt
            });
        }

        if (judgeDecision) {
            timeline.push({
                step: 'results',
                label: judgeDecision.position === 1 ? 'You won!' : 'Finalist placement',
                description: judgeDecision.position === 1
                    ? 'Congratulations! You won this contest'
                    : `You placed #${judgeDecision.position} in this contest`,
                completed: true,
                timestamp: judgeDecision.selectedAt
            });
        } else {
            timeline.push({
                step: 'results',
                label: 'Results pending',
                description: 'Badges and placements will update automatically',
                completed: false,
                timestamp: null
            });
        }
    }

    return timeline;
}

module.exports = router;