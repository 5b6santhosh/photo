const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Following = require('../models/Following');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const isValidObjectId = (id) => id && mongoose.Types.ObjectId.isValid(id);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/follow/toggle
// Toggle follow/unfollow for a target user.
// Response shape mirrors like toggle so the Flutter bloc can handle both uniformly.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/toggle', authMiddleware, async (req, res) => {
    try {
        const followerId = req.user?.id;
        const { userId: targetId } = req.body;

        if (!followerId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (!targetId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (!isValidObjectId(followerId) || !isValidObjectId(targetId)) {
            return res.status(400).json({ error: 'Invalid userId format' });
        }
        if (followerId === targetId) {
            return res.status(400).json({ error: 'You cannot follow yourself' });
        }

        // Verify target user exists
        const targetUser = await User.findById(targetId).select('_id followersCount').lean();
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const followerObjectId = new mongoose.Types.ObjectId(followerId);
        const targetObjectId = new mongoose.Types.ObjectId(targetId);

        // Try to remove (unfollow)
        const removed = await Following.findOneAndDelete({
            follower: followerObjectId,
            following: targetObjectId,
        });

        let following;
        let followersCount;

        if (removed) {
            // ── Unfollow ──────────────────────────────────────────────────────
            following = false;
            const updated = await User.findByIdAndUpdate(
                targetObjectId,
                { $inc: { followersCount: -1 } },
                { new: true }
            ).select('followersCount').lean();

            // Guard against going below 0
            if (updated && updated.followersCount < 0) {
                await User.findByIdAndUpdate(targetObjectId, { $set: { followersCount: 0 } });
                followersCount = 0;
            } else {
                followersCount = updated?.followersCount ?? 0;
            }

        } else {
            // ── Follow ────────────────────────────────────────────────────────
            try {
                await Following.create({
                    follower: followerObjectId,
                    following: targetObjectId,
                });
                following = true;
            } catch (err) {
                // Duplicate key — already following (rapid tap)
                if (err.code === 11000) {
                    following = true;
                } else {
                    throw err;
                }
            }

            const updated = await User.findByIdAndUpdate(
                targetObjectId,
                { $inc: { followersCount: 1 } },
                { new: true }
            ).select('followersCount').lean();

            followersCount = updated?.followersCount ?? 0;
        }

        return res.json({ following, followersCount, userId: targetId });

    } catch (err) {
        console.error('FOLLOW_TOGGLE_ERROR:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/follow/status/:userId
// Check if the authenticated user follows a given user.
// Used by both the feed card and gallery header to resolve initial follow state.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:userId', authMiddleware, async (req, res) => {
    try {
        const followerId = req.user?.id;
        const { userId: targetId } = req.params;

        if (!followerId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (!isValidObjectId(followerId) || !isValidObjectId(targetId)) {
            return res.status(400).json({ error: 'Invalid userId format' });
        }

        const exists = await Following.exists({
            follower: new mongoose.Types.ObjectId(followerId),
            following: new mongoose.Types.ObjectId(targetId),
        });

        const targetUser = await User.findById(targetId)
            .select('followersCount followingCount')
            .lean();

        return res.json({
            following: !!exists,
            followersCount: targetUser?.followersCount ?? 0,
            followingCount: targetUser?.followingCount ?? 0,
            userId: targetId,
        });

    } catch (err) {
        console.error('FOLLOW_STATUS_ERROR:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/follow/followers/:userId     — who follows this user
// GET /api/follow/following/:userId     — who this user follows
// Both are paginated and return the same user shape used by the gallery API.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/followers/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ error: 'Invalid userId' });
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;

        const total = await Following.countDocuments({ following: userId });

        const rows = await Following.find({ following: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate('follower', 'name avatarUrl wins')
            .lean();

        const followers = rows.map(r => _formatFollowUser(r.follower));

        return res.json({
            success: true,
            followers,
            pagination: _paginate(pageNum, limitNum, total),
        });

    } catch (err) {
        console.error('FOLLOWERS_LIST_ERROR:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/following/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ error: 'Invalid userId' });
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;

        const total = await Following.countDocuments({ follower: userId });

        const rows = await Following.find({ follower: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate('following', 'name avatarUrl wins')
            .lean();

        const following = rows.map(r => _formatFollowUser(r.following));

        return res.json({
            success: true,
            following,
            pagination: _paginate(pageNum, limitNum, total),
        });

    } catch (err) {
        console.error('FOLLOWING_LIST_ERROR:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function _formatFollowUser(u) {
    if (!u) return null;
    return {
        id: u._id?.toString(),
        name: u.name || 'Anonymous',
        avatarUrl: u.avatarUrl || '',
        wins: u.wins || 0,
    };
}

function _paginate(page, limit, total) {
    return {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
        hasMore: page < Math.ceil(total / limit),
    };
}

module.exports = router;