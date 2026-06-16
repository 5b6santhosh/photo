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
  (req, res, next) => {
    NotificationController.registerToken(req, res).catch(next);
  }
);

/**
 * Unregister a device token
 * DELETE /api/notifications/unregister-token
 * Body: { token }
 */
router.delete(
  '/unregister-token',
  authMiddleware,
  (req, res, next) => {
    NotificationController.unregisterToken(req, res).catch(next);
  }
);

/**
 * Get all active tokens for authenticated user
 * GET /api/notifications/my-tokens
 */
router.get(
  '/my-tokens',
  authMiddleware,
  (req, res, next) => {
    NotificationController.getUserTokens(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.getNotifications(req, res).catch(next);
  }
);

/**
 * Mark specific notification as read
 * PATCH /api/notifications/:id/read
 */
router.patch(
  '/:id/read',
  authMiddleware,
  (req, res, next) => {
    NotificationController.markAsRead(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.sendToUser(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.sendBatch(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.sendDataOnly(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.sendWithNavigation(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.getStats(req, res).catch(next);
  }
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
  (req, res, next) => {
    NotificationController.cleanupInvalidTokens(req, res).catch(next);
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

router.use((error, req, res, next) => {
  handleError(error, req, res);
});

module.exports = router;
