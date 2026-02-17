
// routes/contestDetails.js (or add to your existing contest routes)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Contest = require('../models/Contest');
const ContestEntry = require('../models/ContestEntry');
const Payment = require('../models/Payment');
const FileMeta = require('../models/FileMeta');
const { authMiddleware: authMiddleware } = require('../middleware/auth');

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

router.get('/:contestId/details', async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user?.id || null; 

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

        // User's entry (only if authenticated)
        let contestEntry = null;
        if (userId) {
            const entry = await ContestEntry.findOne({ userId, contestId }).lean();
            if (entry) {
                contestEntry = {
                    id: entry._id.toString(),
                    status: entry.status,
                    submittedAt: entry.submittedAt,
                    photos: entry.photos || [],
                    videos: entry.videos || [],
                };
            }
        }

        // Stats
        const totalSubmissions = await ContestEntry.countDocuments({
            contestId,
            status: { $in: ['submitted', 'approved', 'rejected'] }
        });

        const mySubmissions = userId ? await ContestEntry.countDocuments({
            userId,
            contestId,
            status: { $in: ['submitted', 'approved', 'rejected'] }
        }) : 0;

        // Status calculation
        const now = new Date();
        const isActive = contest.isOpenForSubmissions &&
            now >= new Date(contest.startDate) &&
            now <= new Date(contest.endDate);
        const isUpcoming = now < new Date(contest.startDate);
        const isCompleted = now > new Date(contest.endDate);

        // Time label
        let timeLabel = '';
        if (isActive) {
            const daysLeft = Math.ceil((new Date(contest.endDate) - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
        } else if (isUpcoming) {
            const daysUntil = Math.ceil((new Date(contest.startDate) - now) / (1000 * 60 * 60 * 24));
            timeLabel = daysUntil === 1 ? 'Starts in 1 day' : `Starts in ${daysUntil} days`;
        } else {
            timeLabel = 'Ended';
        }

        res.json({
            success: true,
            data: {
                id: contest._id.toString(),
                title: contest.title,
                subtitle: contest.subtitle || contest.description,
                description: contest.description,
                prizeText: contest.prizeText || `₹${contest.entryFee || 0}`,
                entryFee: contest.entryFee || 0,
                startDate: contest.startDate,
                endDate: contest.endDate,
                isActive,
                isUpcoming,
                isCompleted,
                isOpenForSubmissions: contest.isOpenForSubmissions,
                timeLabel,
                totalSubmissions,
                mySubmissions,
                highlightPhotos, 
                coverImage: highlightPhotos.length > 0 ? highlightPhotos[0].url : null,
                contestEntry,
                paymentStatus,
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

module.exports = router;