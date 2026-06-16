const pino = require('pino');
const fcmService = require('../services/fcmService');
const DeviceToken = require('../models/DeviceToken');
const Notification = require('../models/Notification');
const {
  registerTokenSchema,
  sendNotificationSchema,
  sendBatchSchema,
  sendDataOnlySchema,
  unregisterTokenSchema,
  sendDataWithPayloadSchema
} = require('../utils/fcmValidation');
const {
  ValidationError,
  NotFoundError,
  asyncHandler
} = require('../utils/fcmErrors');

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

class NotificationController {
  /**
   * Register or update a device token for the authenticated user
   */
  static registerToken = asyncHandler(async (req, res) => {
    const { token, deviceType, deviceName } = registerTokenSchema.parse(req.body);
    const userId = req.user?.id;

    if (!userId) {
      throw new ValidationError('User ID not found in request');
    }

    // Check if token already exists for this user
    const existingToken = await DeviceToken.findOne({ token });

    if (existingToken) {
      if (existingToken.userId.toString() === userId.toString()) {
        // Reactivate existing token
        existingToken.isActive = true;
        existingToken.invalidatedAt = null;
        existingToken.invalidReason = null;
        existingToken.lastUsedAt = new Date();
        await existingToken.save();

        logger.info(
          { userId, tokenSuffix: token.slice(-10) },
          'Existing device token reactivated'
        );

        return res.json({
          success: true,
          message: 'Device token reactivated',
          tokenId: existingToken._id
        });
      }

      // Token exists but belongs to another user - mark it as used
      await DeviceToken.updateOne(
        { token },
        {
          lastUsedAt: new Date()
        }
      );
    }

    // Create or update device token
    let deviceTokenDoc = await DeviceToken.findOne({ token, userId });

    if (deviceTokenDoc) {
      deviceTokenDoc.deviceType = deviceType;
      deviceTokenDoc.deviceName = deviceName || deviceTokenDoc.deviceName;
      deviceTokenDoc.isActive = true;
      deviceTokenDoc.invalidatedAt = null;
      deviceTokenDoc.invalidReason = null;
      deviceTokenDoc.lastUsedAt = new Date();
      await deviceTokenDoc.save();

      logger.info(
        { userId, tokenSuffix: token.slice(-10) },
        'Device token updated'
      );
    } else {
      deviceTokenDoc = await DeviceToken.create({
        userId,
        token,
        deviceType,
        deviceName: deviceName || null
      });

      logger.info(
        { userId, deviceType, tokenSuffix: token.slice(-10) },
        'New device token registered'
      );
    }

    res.status(201).json({
      success: true,
      message: 'Device token registered successfully',
      tokenId: deviceTokenDoc._id
    });
  });

  /**
   * Unregister a device token
   */
  static unregisterToken = asyncHandler(async (req, res) => {
    const { token } = unregisterTokenSchema.parse(req.body);
    const userId = req.user?.id;

    if (!userId) {
      throw new ValidationError('User ID not found in request');
    }

    const deviceToken = await DeviceToken.findOneAndDelete({
      token,
      userId
    });

    if (!deviceToken) {
      throw new NotFoundError('Device token not found');
    }

    logger.info(
      { userId, tokenSuffix: token.slice(-10) },
      'Device token unregistered'
    );

    res.json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  });

  /**
   * Get all active tokens for authenticated user
   */
  static getUserTokens = asyncHandler(async (req, res) => {
    const userId = req.user?.id;

    if (!userId) {
      throw new ValidationError('User ID not found in request');
    }

    const tokens = await DeviceToken.find({ userId, isActive: true }).select(
      'token deviceType deviceName lastUsedAt createdAt'
    );

    logger.debug({ userId, count: tokens.length }, 'Retrieved user device tokens');

    res.json({
      success: true,
      data: tokens,
      count: tokens.length
    });
  });

  /**
   * Send notification to a specific user
   */
  static sendToUser = asyncHandler(async (req, res) => {
    const { userId, title, body, data } = sendNotificationSchema.parse(req.body);

    const result = await fcmService.sendToUser(userId, {
      title,
      body,
      data: data || {}
    });

    if (result.sent === 0) {
      logger.warn({ userId }, 'No active tokens found for user');
      return res.status(404).json({
        success: false,
        error: 'No active tokens found for user'
      });
    }

    logger.info(
      { userId, sent: result.sent, failed: result.failed },
      'Notification sent to user'
    );

    res.json({
      success: true,
      message: 'Notification sent',
      ...result
    });
  });

  /**
   * Send notification to multiple tokens
   */
  static sendBatch = asyncHandler(async (req, res) => {
    const { tokens, title, body, data } = sendBatchSchema.parse(req.body);

    const result = await fcmService.sendMultiple(tokens, {
      title,
      body,
      data: data || {}
    });

    logger.info(
      { sent: result.sent, failed: result.failed, total: tokens.length },
      'Batch notification sent'
    );

    res.json({
      success: result.failed === 0,
      sent: result.sent,
      failed: result.failed,
      ...(result.errors && result.errors.length > 0 && { errors: result.errors })
    });
  });

  /**
   * Send data-only notification (no UI notification, just data payload)
   */
  static sendDataOnly = asyncHandler(async (req, res) => {
    const { token, data } = sendDataOnlySchema.parse(req.body);

    const messageId = await fcmService.sendDataOnly(token, data);

    logger.debug(
      { messageId, tokenSuffix: token.slice(-10) },
      'Data-only notification sent'
    );

    res.json({
      success: true,
      message: 'Data payload sent',
      messageId
    });
  });

  /**
   * Send notification with Flutter-specific navigation payload
   */
  static sendWithNavigation = asyncHandler(
    async (req, res) => {
      const { token, data, route, action, metadata } = sendDataWithPayloadSchema.parse(
        req.body
      );

      const navigationData = {
        ...data,
        ...(route && { route }),
        ...(action && { action }),
        ...(metadata && { metadata: JSON.stringify(metadata) })
      };

      const messageId = await fcmService.sendDataOnly(token, navigationData);

      logger.debug(
        { messageId, route, action, tokenSuffix: token.slice(-10) },
        'Navigation notification sent'
      );

      res.json({
        success: true,
        message: 'Navigation payload sent',
        messageId,
        route,
        action
      });
    }
  );

  /**
   * Get token statistics (admin only)
   */
  static getStats = asyncHandler(async (req, res) => {
    const stats = await fcmService.getTokenStats();

    logger.debug(stats, 'Token statistics retrieved');

    res.json({
      success: true,
      stats
    });
  });

  /**
   * Manually trigger cleanup of invalid tokens (admin only)
   */
  static cleanupInvalidTokens = asyncHandler(
    async (req, res) => {
      const result = await fcmService.pruneInvalidTokens();

      logger.info(
        { deletedCount: result.deletedCount },
        'Invalid tokens cleaned up via manual trigger'
      );

      res.json({
        success: true,
        message: 'Invalid tokens cleaned up successfully',
        deletedCount: result.deletedCount
      });
    }
  );

  /**
   * Get notification history for authenticated user
   */
  static getNotifications = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new ValidationError('User ID not found in request');
    }

    const notifications = await Notification.find({ recipientId: userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      data: notifications,
      count: notifications.length
    });
  });

  /**
   * Mark a specific notification as read
   */
  static markAsRead = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      throw new ValidationError('User ID not found in request');
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipientId: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  });
}

module.exports = NotificationController;
