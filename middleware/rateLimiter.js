const rateLimit = require('express-rate-limit');
const pino = require('pino');

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const registerTokenLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || '900000', 10), // 15 min default
  max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX_REQUESTS || '50', 10), // 50 requests
  message: 'Too many token registrations. Please try again later.',
  statusCode: 429,
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        userId: req.user?.id,
        endpoint: req.path
      },
      'Rate limit exceeded for token registration'
    );
    res.status(429).json({
      success: false,
      error: 'Too many token registrations. Please try again later.',
      retryAfter: req.rateLimit?.resetTime
    });
  },
  skip: (req) => {
    return req.user?.role === 'admin';
  },
  keyGenerator: (req) => {
    return req.user?.id || req.ip || 'unknown';
  }
});

const sendNotificationLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_SEND_WINDOW_MS || '60000', 10), // 1 min default
  max: parseInt(process.env.RATE_LIMIT_SEND_MAX_REQUESTS || '10', 10), // 10 requests
  message: 'Too many notification requests. Please try again later.',
  statusCode: 429,
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        userId: req.user?.id,
        endpoint: req.path
      },
      'Rate limit exceeded for notification send'
    );
    res.status(429).json({
      success: false,
      error: 'Too many notification requests. Please try again later.',
      retryAfter: req.rateLimit?.resetTime
    });
  },
  keyGenerator: (req) => {
    return req.user?.id || req.ip || 'unknown';
  }
});

const batchSendLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_SEND_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_SEND_MAX_REQUESTS || '5', 10), // Stricter for batch
  message: 'Too many batch requests. Please try again later.',
  statusCode: 429,
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        userId: req.user?.id,
        batchSize: (req.body?.tokens || []).length
      },
      'Rate limit exceeded for batch send'
    );
    res.status(429).json({
      success: false,
      error: 'Too many batch requests. Please try again later.',
      retryAfter: req.rateLimit?.resetTime
    });
  },
  keyGenerator: (req) => {
    return req.user?.id || req.ip || 'unknown';
  }
});

module.exports = {
  registerTokenLimiter,
  sendNotificationLimiter,
  batchSendLimiter
};
