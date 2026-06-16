// routes/admin/createAdminEvents.js  (matches your app.js registration)
const express = require('express');
const router = express.Router();
const Contest = require('../../models/Contest');
const ContestRules = require('../../models/ContestRules');
const { upload, handleUploadError } = require('../../middleware/upload');
const { uploadToProvider } = require('../../services/storageService');

/**
 * POST /api/admin/events
 * Create curated contest
 */
router.post(
    '/',
    (req, res, next) => {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            upload.single('bannerImage')(req, res, next);
        } else {
            next();
        }
    },
    handleUploadError,
    async (req, res) => {
        try {
            const {
                title,
                subtitle,
                description,
                prizeText,
                startDate,
                endDate,
                allowedMediaTypes,
                maxSubmissionsPerUser,
                theme,
                keywords,
                entryFee
            } = req.body;

            if (!title || !startDate || !endDate) {
                return res.status(400).json({ message: 'Missing required fields: title, startDate, endDate' });
            }

            // Resolve bannerImage: file upload takes priority, then JSON URL string
            let bannerImageUrl = null;

            if (req.file) {
                try {
                    const cloudFile = await uploadToProvider(req.file);
                    bannerImageUrl = cloudFile.url;
                } catch (uploadErr) {
                    console.error('Banner upload error:', uploadErr);
                    return res.status(500).json({ message: 'Banner image upload failed' });
                }
            } else if (req.body.bannerImage && typeof req.body.bannerImage === 'string' && req.body.bannerImage.trim()) {
                bannerImageUrl = req.body.bannerImage.trim();
            }

            const creatorId = '600000000000000000000000';

            // Step 1: Create contest — pre('save') fires once (isNew = true).
            // With the fixed Contest.js, this is the ONLY time pre('save') touches
            // contestStatus. bannerImage is saved correctly here.
            const contest = await Contest.create({
                title,
                subtitle: subtitle || '',
                description: description || '',
                prizeText: prizeText || undefined,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                allowedMediaTypes: allowedMediaTypes
                    ? (Array.isArray(allowedMediaTypes)
                        ? allowedMediaTypes
                        : JSON.parse(allowedMediaTypes))
                    : ['image'],
                //  allowedMediaTypes: allowedMediaTypes || ['image'],
                bannerImage: bannerImageUrl || null,
                maxSubmissionsPerUser: maxSubmissionsPerUser || 1,
                entryFee: entryFee || 0,
                createdBy: creatorId,
            });

            const rules = await ContestRules.create({
                contestId: contest._id,
                theme: theme || 'General',
                keywords: keywords || [],
                autoRejectNSFW: true,
                strictThemeMatch: false,
                allowPeople: true,
                requireVertical: false,
                minEntropy: 4.5,
                maxEntropy: 7.5,
                preferredColor: 'any',
                skinRange: [0, 40],
                allowImage: true,
                allowVideo: true,
                maxDurationSeconds: 60,
                autoApproveScore: 75,
                autoReviewScore: 50
            });

            await Contest.findByIdAndUpdate(
                contest._id,
                { $set: { rules: rules._id } }
            );

            // Broadcast FCM notification to all active device tokens
            const DeviceToken = require('../../models/DeviceToken');
            const fcmService = require('../../services/fcmService');
            DeviceToken.find({ isActive: true })
                .select('token userId')
                .lean()
                .then(tokens => {
                    if (tokens && tokens.length > 0) {
                        const tokenStrings = tokens.map(t => t.token);
                        fcmService.sendMultiple(tokenStrings, {
                            title: '🏆 New Event Created',
                            body: `Join the new contest: "${title}" now!`,
                            data: {
                                type: 'new_event',
                                contestId: contest._id.toString()
                            }
                        }).catch(err => console.error('Error sending event broadcast:', err));

                        // Persist to Notification tracking for targeted users
                        const Notification = require('../../models/Notification');
                        const notificationDocs = tokens
                            .filter(t => t.userId)
                            .map(t => ({
                                recipientId: t.userId,
                                title: '🏆 New Event Created',
                                body: `Join the new contest: "${title}" now!`,
                                type: 'new_event',
                                metadata: {
                                    type: 'new_event',
                                    contestId: contest._id.toString()
                                }
                            }));

                        if (notificationDocs.length > 0) {
                            Notification.insertMany(notificationDocs)
                                .catch(err => console.error('Error persisting event broadcast notifications:', err));
                        }
                    }
                })
                .catch(err => console.error('Error fetching tokens for event broadcast:', err));

            res.status(201).json({
                message: 'Event created successfully',
                eventId: contest._id,
                rulesId: rules._id,
                bannerImage: bannerImageUrl || null,
            });

        } catch (err) {
            console.error('Event creation error:', err);
            res.status(500).json({ message: 'Event creation failed', detail: err.message });
        }
    }
);

module.exports = router;