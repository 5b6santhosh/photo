const express = require('express');
const mongoose = require('mongoose');
const Like = require('../models/Like');
const FileMeta = require('../models/FileMeta');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/likes/toggle
 * Atomically toggles like status using findOneAndUpdate + aggregated count.
 * Safe against rapid clicks, network retries, and race conditions.
 */
router.post('/toggle', authMiddleware, async (req, res) => {
    const session = await mongoose.startSession();

    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { fileId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId is required' });

        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId format' });
        }

        const fileObjectId = new mongoose.Types.ObjectId(fileId);
        const userObjectId = new mongoose.Types.ObjectId(req.user.id);

        let liked;

        await session.withTransaction(async () => {
            // Try to delete an existing like (unlike)
            const removed = await Like.findOneAndDelete(
                { fileId: fileObjectId, userId: userObjectId },
                { session }
            );

            if (removed) {
                // Unlike: decrement, floor at 0
                await FileMeta.findByIdAndUpdate(
                    fileObjectId,
                    [{ $set: { likesCount: { $max: [0, { $subtract: ['$likesCount', 1] }] } } }],
                    { session }
                );
                liked = false;
            } else {
                // Like: upsert to handle duplicate key gracefully
                const result = await Like.updateOne(
                    { fileId: fileObjectId, userId: userObjectId },
                    { $setOnInsert: { fileId: fileObjectId, userId: userObjectId } },
                    { upsert: true, session }
                );

                // Only increment if a new doc was actually inserted
                if (result.upsertedCount > 0) {
                    await FileMeta.findByIdAndUpdate(
                        fileObjectId,
                        { $inc: { likesCount: 1 } },
                        { session }
                    );
                }
                liked = true;
            }
        });

        // Read the authoritative count AFTER the transaction
        const meta = await FileMeta.findById(fileObjectId).lean();

        // Trigger FCM notification for milestones: 50, 500, 1000, 1000000 likes
        if (liked && meta && meta.createdBy) {
            const likesCount = meta.likesCount ?? 0;
            const milestones = [50, 500, 1000, 1000000];
            for (const milestone of milestones) {
                if (likesCount >= milestone) {
                    const updated = await FileMeta.findOneAndUpdate(
                        {
                            _id: fileObjectId,
                            likesCount: { $gte: milestone },
                            reachedMilestones: { $ne: milestone }
                        },
                        {
                            $addToSet: { reachedMilestones: milestone }
                        },
                        { new: true }
                    );

                    if (updated) {
                        const fcmService = require('../services/fcmService');
                        const Notification = require('../models/Notification');
                        const notificationPayload = {
                            title: '🎉 Milestone Reached!',
                            body: `Your photo "${meta.title || meta.originalName || 'Photo'}" has reached ${milestone} likes!`,
                            data: {
                                type: 'like_milestone',
                                fileId: fileId,
                                likesCount: milestone.toString()
                            }
                        };

                        // Persist to Notification tracking first, then send FCM
                        Notification.create({
                            recipientId: meta.createdBy,
                            title: notificationPayload.title,
                            body: notificationPayload.body,
                            type: 'like_milestone',
                            metadata: notificationPayload.data
                        }).then(doc => {
                            const payloadWithId = {
                                ...notificationPayload,
                                data: {
                                    ...notificationPayload.data,
                                    notificationId: doc._id.toString()
                                }
                            };
                            fcmService.sendToUser(doc.recipientId.toString(), payloadWithId)
                                .catch(err => console.error('Error sending like milestone notification:', err));
                        }).catch(err => console.error('Error persisting/sending like milestone notification:', err));
                    }
                }
            }
        }

        return res.json({
            liked,
            likesCount: meta?.likesCount ?? 0,
        });

    } catch (err) {
        console.error('Like toggle error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        session.endSession();
    }
});

/**
 * POST /api/likes/repair/:fileId
 * Admin utility — recomputes likesCount from actual Like documents.
 * Call this once to fix any historical drift.
 */
router.post('/repair/:fileId', authMiddleware, async (req, res) => {
    try {
        const { fileId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ error: 'Invalid fileId' });
        }

        const count = await Like.countDocuments({
            fileId: new mongoose.Types.ObjectId(fileId),
        });

        await FileMeta.findByIdAndUpdate(fileId, { likesCount: count });

        return res.json({ repaired: true, likesCount: count });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
