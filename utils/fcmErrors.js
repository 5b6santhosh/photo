const pino = require('pino');
const { ZodError } = require('zod');

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

class FcmError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'FcmError';
  }
}

class ValidationError extends FcmError {
  constructor(message) {
    super(400, 'VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends FcmError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

class UnauthorizedError extends FcmError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

class FcmAuthError extends FcmError {
  constructor(message = 'FCM authentication failed') {
    super(500, 'FCM_AUTH_ERROR', message);
    this.name = 'FcmAuthError';
  }
}

class RateLimitError extends FcmError {
  constructor(retryAfter) {
    super(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.');
    this.retryAfter = retryAfter;
    this.name = 'RateLimitError';
  }
}

const handleError = (error, req, res) => {
  const requestContext = {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id
  };

  if (error instanceof FcmError) {
    logger.warn(
      {
        ...requestContext,
        errorCode: error.code,
        statusCode: error.statusCode
      },
      error.message
    );

    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      ...(error instanceof RateLimitError && { retryAfter: error.retryAfter })
    });
  }

  if (error instanceof ZodError) {
    const details = error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code
    }));

    logger.warn(
      {
        ...requestContext,
        validationErrors: details
      },
      'Validation error'
    );

    return res.status(400).json({
      success: false,
      error: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details
    });
  }

  if (error instanceof Error) {
    logger.error(
      {
        ...requestContext,
        errorName: error.name,
        errorMessage: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
      },
      'Unexpected error'
    );

    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message,
      code: 'INTERNAL_SERVER_ERROR'
    });
  }

  logger.error(
    {
      ...requestContext,
      error: String(error)
    },
    'Unknown error occurred'
  );

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR'
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};

module.exports = {
  FcmError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  FcmAuthError,
  RateLimitError,
  handleError,
  asyncHandler
};
