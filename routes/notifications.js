const express = require('express');
const NotificationController = require('./notificationController');
const {
  registerTokenLimiter,
  sendNotificationLimiter,
  batchSendLimiter
} = require('../middleware/rateLimiter');
const { handleError } = require('../utils/fcmErrors');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

/**
 * Health check - no authentication required
 * GET /api/notifications/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'FCM notification service is healthy',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// USER DEVICE TOKEN MANAGEMENT
// ============================================================================

/**
 * Register or update device token
 * POST /api/notifications/register-token
 * Body: { token, deviceType, deviceName? }
 */
router.post(
  '/register-token',
  authMiddleware,
  registerTokenLimiter,
  NotificationController.registerToken
);

/**
 * Unregister a device token
 * DELETE /api/notifications/unregister-token
 * Body: { token }
 */
router.delete(
  '/unregister-token',
  authMiddleware,
  NotificationController.unregisterToken
);

/**
 * Get all active tokens for authenticated user
 * GET /api/notifications/my-tokens
 */
router.get(
  '/my-tokens',
  authMiddleware,
  NotificationController.getUserTokens
);

// ============================================================================
// NOTIFICATION INBOX HISTORY
// ============================================================================

/**
 * Get notification history for authenticated user
 * GET /api/notifications
 */
router.get(
  '/',
  authMiddleware,
  NotificationController.getNotifications
);

/**
 * Mark specific notification as read
 * PATCH /api/notifications/:id/read
 */
router.patch(
  '/:id/read',
  authMiddleware,
  NotificationController.markAsRead
);

// ============================================================================
// NOTIFICATION SENDING
// ============================================================================

/**
 * Send notification to a specific user
 * POST /api/notifications/send-to-user
 * Body: { userId, title, body, data? }
 */
router.post(
  '/send-to-user',
  authMiddleware,
  sendNotificationLimiter,
  NotificationController.sendToUser
);

/**
 * Send notification to multiple tokens
 * POST /api/notifications/send-batch
 * Body: { tokens: [], title, body, data? }
 */
router.post(
  '/send-batch',
  authMiddleware,
  batchSendLimiter,
  NotificationController.sendBatch
);

/**
 * Send data-only notification (no UI notification)
 * POST /api/notifications/send-data-only
 * Body: { token, data }
 */
router.post(
  '/send-data-only',
  authMiddleware,
  sendNotificationLimiter,
  NotificationController.sendDataOnly
);

/**
 * Send notification with Flutter navigation payload
 * POST /api/notifications/send-navigation
 * Body: { token, data, route?, action?, metadata? }
 */
router.post(
  '/send-navigation',
  authMiddleware,
  sendNotificationLimiter,
  NotificationController.sendWithNavigation
);

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * Get token statistics
 * GET /api/notifications/stats
 * Admin only
 */
router.get(
  '/stats',
  authMiddleware,
  requireAdmin,
  NotificationController.getStats
);

/**
 * Manually trigger cleanup of invalid tokens
 * POST /api/notifications/cleanup
 * Admin only
 */
router.post(
  '/cleanup',
  authMiddleware,
  requireAdmin,
  NotificationController.cleanupInvalidTokens
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

router.use((error, req, res, next) => {
  handleError(error, req, res);
});

module.exports = router;
