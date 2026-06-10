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


// const express = require('express');
// const mongoose = require('mongoose');
// const Like = require('../models/Like');
// const FileMeta = require('../models/FileMeta');
// // FIX: Import authMiddleware (not protect)
// const { authMiddleware } = require('../middleware/auth');

// const router = express.Router();

// /**
//  * POST /api/likes/toggle
//  * Toggles like status for a file by a user
//  */
// // FIX: Use authMiddleware instead of protect
// router.post('/toggle', authMiddleware, async (req, res) => {
//     try {
//         // Defensive check (optional since authMiddleware guarantees req.user)
//         if (!req.user || !req.user.id) {
//             return res.status(401).json({ error: 'Not authenticated' });
//         }

//         const userId = req.user.id;
//         const { fileId } = req.body;

//         if (!fileId) {
//             return res.status(400).json({ error: 'fileId is required' });
//         }

//         // Validate and convert to ObjectId
//         if (!mongoose.Types.ObjectId.isValid(fileId)) {
//             return res.status(400).json({ error: 'Invalid fileId format' });
//         }
//         if (!mongoose.Types.ObjectId.isValid(userId)) {
//             return res.status(400).json({ error: 'Invalid userId format' });
//         }

//         const fileObjectId = new mongoose.Types.ObjectId(fileId);
//         const userObjectId = new mongoose.Types.ObjectId(userId);

//         // 1. Attempt to remove the like first (Unlike)
//         const removed = await Like.findOneAndDelete({
//             fileId: fileObjectId,
//             userId: userObjectId
//         });

//         let liked;
//         let updatedMeta;

//         if (removed) {
//             liked = false;
//             updatedMeta = await FileMeta.findByIdAndUpdate(
//                 fileObjectId,
//                 { $inc: { likesCount: -1 } },
//                 { new: true }
//             );
//             // Ensure likesCount doesn't go below 0
//             if (updatedMeta && updatedMeta.likesCount < 0) {
//                 updatedMeta.likesCount = 0;
//                 await updatedMeta.save();
//             }
//         } else {
//             // 2. Attempt to create the like (Like)
//             try {
//                 await Like.create({
//                     fileId: fileObjectId,
//                     userId: userObjectId
//                 });
//                 liked = true;
//                 updatedMeta = await FileMeta.findByIdAndUpdate(
//                     fileObjectId,
//                     { $inc: { likesCount: 1 } },
//                     { new: true }
//                 );
//             } catch (err) {
//                 // Handle duplicate key error (rapid double-click)
//                 if (err.code === 11000) {
//                     liked = true;
//                     updatedMeta = await FileMeta.findById(fileObjectId);
//                 } else {
//                     throw err;
//                 }
//             }
//         }

//         res.json({
//             liked,
//             likesCount: updatedMeta?.likesCount ?? 0,
//         });
//     } catch (err) {
//         console.error('Like toggle error:', err);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// });

// module.exports = router;