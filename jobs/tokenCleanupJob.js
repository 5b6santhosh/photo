const cron = require('node-cron');
const pino = require('pino');
const fcmService = require('../services/fcmService');
const DeviceToken = require('../models/DeviceToken');

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const initializeCleanupJobs = () => {
  const cleanupSchedule = process.env.FCM_CLEANUP_CRON_SCHEDULE || '0 2 * * *';

  cron.schedule(cleanupSchedule, async () => {
    try {
      logger.info('Starting scheduled FCM token cleanup job');
      const result = await fcmService.pruneInvalidTokens();
      logger.info(
        {
          deletedCount: result.deletedCount,
          schedule: cleanupSchedule
        },
        'FCM token cleanup job completed successfully'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        {
          error: message,
          schedule: cleanupSchedule
        },
        'FCM token cleanup job failed'
      );
    }
  });

  logger.info({ schedule: cleanupSchedule }, 'FCM token cleanup job scheduled');
};

const initializeStatsJob = () => {
  const statsSchedule = process.env.FCM_STATS_CRON_SCHEDULE || '0 1 * * 0';

  cron.schedule(statsSchedule, async () => {
    try {
      logger.info('Starting weekly FCM statistics collection');
      const stats = await fcmService.getTokenStats();
      logger.info(
        {
          ...stats,
          timestamp: new Date().toISOString()
        },
        'Weekly FCM token statistics'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        {
          error: message,
          schedule: statsSchedule
        },
        'FCM statistics job failed'
      );
    }
  });

  logger.info({ schedule: statsSchedule }, 'FCM statistics job scheduled');
};

const initializeInactiveTokenJob = () => {
  const inactiveSchedule = process.env.FCM_INACTIVE_CRON_SCHEDULE || '0 * * * *';

  cron.schedule(inactiveSchedule, async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await DeviceToken.deleteMany({
        isActive: true,
        lastUsedAt: { $lt: thirtyDaysAgo }
      });

      if (result.deletedCount > 0) {
        logger.info(
          { deletedCount: result.deletedCount },
          'Removed inactive tokens not used in 30 days'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        {
          error: message,
          schedule: inactiveSchedule
        },
        'Inactive token cleanup job failed'
      );
    }
  });

  logger.info({ schedule: inactiveSchedule }, 'Inactive token cleanup job scheduled');
};

const startAllCleanupJobs = () => {
  logger.info('Initializing FCM scheduled jobs');
  initializeCleanupJobs();
  initializeStatsJob();
  initializeInactiveTokenJob();
  logger.info('All FCM scheduled jobs initialized');
};

const stopAllCleanupJobs = () => {
  cron.getTasks().forEach(task => {
    task.stop();
    task.destroy();
  });
  logger.info('All FCM scheduled jobs stopped');
};

module.exports = {
  initializeCleanupJobs,
  initializeStatsJob,
  initializeInactiveTokenJob,
  startAllCleanupJobs,
  stopAllCleanupJobs
};
