const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getAuth } = require('google-auth-library');
const pino = require('pino');
const DeviceToken = require('../models/DeviceToken');

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

class FcmService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.auth = null;
    this.projectId = null;
    this.isEnabled = false;
    this.maxRetries = parseInt(process.env.FCM_MAX_RETRIES || '3', 10);
    this.requestTimeout = parseInt(process.env.FCM_REQUEST_TIMEOUT_MS || '10000', 10);
    this.cacheTtl = parseInt(process.env.FCM_TOKEN_CACHE_TTL_MS || '3600000', 10);
    this.batchSize = parseInt(process.env.FCM_BATCH_SIZE || '100', 10);

    this.initialize();
  }

  initialize() {
    try {
      const serviceAccount = this.loadServiceAccount();
      this.projectId = serviceAccount.project_id;

      if (!this.projectId) {
        throw new Error('project_id not found in service account credentials');
      }

      this.auth = new getAuth().fromJSON(serviceAccount);
      this.isEnabled = true;
      logger.info({ projectId: this.projectId }, 'FCM service initialized successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ error: message }, 'FCM initialization failed. FCM features will be disabled.');
      this.isEnabled = false;
    }
  }

  loadServiceAccount() {
    // Try base64-encoded credential first (for containerized deployments)
    const base64Credential = process.env.FCM_SERVICE_ACCOUNT_B64;
    if (base64Credential) {
      try {
        const decoded = Buffer.from(base64Credential, 'base64').toString('utf-8');
        logger.debug('Loaded FCM credentials from base64 environment variable');
        return JSON.parse(decoded);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: message }, 'Failed to parse base64 credentials');
        throw new Error(`Invalid base64 credentials: ${message}`);
      }
    }

    // Fall back to file path
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
      throw new Error(
        'Neither FCM_SERVICE_ACCOUNT_B64 nor GOOGLE_APPLICATION_CREDENTIALS environment variable is set'
      );
    }

    const resolvedPath = path.resolve(credPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Service account file not found: ${resolvedPath}`);
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      logger.debug({ path: resolvedPath }, 'Loaded FCM credentials from file');
      return JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load service account from ${resolvedPath}: ${message}`);
    }
  }

  async getAccessToken() {
    if (!this.isEnabled) {
      throw new Error('FCM service is disabled');
    }
    try {
      const now = Date.now();

      // Return cached token if still valid (with 60s buffer)
      if (this.accessToken && this.tokenExpiry && now < this.tokenExpiry - 60000) {
        return this.accessToken;
      }

      if (!this.auth) {
        throw new Error('FCM auth not initialized');
      }

      const response = await this.auth.getAccessToken();
      this.accessToken = response.token;
      this.tokenExpiry = response.expiry_date;

      logger.debug('FCM access token refreshed');
      return this.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Failed to obtain FCM access token');
      throw new Error('FCM authentication failed');
    }
  }

  async sendNotification(token, options) {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping notification send.');
      return 'mock-message-id-disabled';
    }
    if (!token || typeof token !== 'string') {
      throw new Error('Valid device token required');
    }

    const { title, body, data = {}, android = {}, apns = {}, webpush = {} } = options;
    const sanitizedData = this._sanitizeData(data);

    const message = {
      token,
      ...((title || body) && {
        notification: {
          title: title || 'Notification',
          body: body || ''
        }
      }),
      ...(Object.keys(sanitizedData).length > 0 && { data: sanitizedData }),
      ...(Object.keys(android).length > 0 && { android }),
      ...(Object.keys(apns).length > 0 && { apns }),
      ...(Object.keys(webpush).length > 0 && { webpush })
    };

    return this._sendMessage(message, token);
  }

  async sendDataOnly(token, data) {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping data-only notification send.');
      return 'mock-message-id-disabled';
    }
    if (!token || typeof token !== 'string') {
      throw new Error('Valid device token required');
    }

    if (!data || Object.keys(data).length === 0) {
      throw new Error('Data payload cannot be empty');
    }

    const sanitizedData = this._sanitizeData(data);
    const message = { token, data: sanitizedData };
    return this._sendMessage(message, token);
  }

  async sendMultiple(tokens, options, customBatchSize) {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping batch notification send.');
      return {
        sent: 0,
        failed: tokens.length,
        errors: tokens.map(token => ({ token, success: false, error: 'FCM service disabled' }))
      };
    }
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('Valid token array required');
    }

    const results = [];
    const errors = [];
    const batchSize = customBatchSize || this.batchSize;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const promises = batch.map(token =>
        this.sendNotification(token, options)
          .then(messageId => results.push({ token, success: true, messageId }))
          .catch(error =>
            errors.push({
              token,
              success: false,
              error: error.message
            })
          )
      );

      await Promise.all(promises);
    }

    if (errors.length > 0) {
      await this._handleSendErrors(errors);
    }

    logger.info({ sent: results.length, failed: errors.length }, 'Batch send completed');

    return {
      sent: results.length,
      failed: errors.length,
      ...(errors.length > 0 && { errors })
    };
  }

  async sendToUser(userId, options) {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping send to user.');
      return { sent: 0, failed: 0 };
    }
    try {
      const tokens = await DeviceToken.findActiveByUserId(userId);

      if (tokens.length === 0) {
        logger.warn({ userId }, 'No active tokens found for user');
        return { sent: 0, failed: 0 };
      }

      const tokenList = tokens.map(t => t.token);
      return this.sendMultiple(tokenList, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ userId, error: message }, 'Error sending notification to user');
      throw error;
    }
  }

  _sanitizeData(data) {
    if (!data || typeof data !== 'object') return {};
    
    const sensitiveKeys = [
      'password', 'token', 'jwt', 'authorization', 'auth', 'secret', 'key', 
      'email', 'phone', 'ssn', 'creditcard', 'cc', 'cvv', 'auth_token', 
      'authtoken', 'pass', 'credential', 'private', 'api_key', 'apikey'
    ];
    // Robust email validation regex (RFC 5322 compliant simple form)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    // Robust JWT matching eyJ... with 3 segments
    const jwtRegex = /^eyJ[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_+/=]*$/;

    // Set tracker to prevent circular reference/cyclic memory crashes
    const visited = new Set();

    const sanitizeValue = (val) => {
      if (val === null || val === undefined) return val;
      
      // Prevent circular reference loops
      if (typeof val === 'object') {
        if (visited.has(val)) {
          logger.warn('FCM payload deep sanitization: Circular reference detected and bypassed.');
          return '[Circular]';
        }
        visited.add(val);
      }

      // If array, sanitize each item recursively
      if (Array.isArray(val)) {
        const cleanedArr = val.map(item => sanitizeValue(item));
        visited.delete(val);
        return cleanedArr;
      }
      
      // If object, sanitize each key/value recursively
      if (typeof val === 'object') {
        const sanitizedObj = {};
        for (const k of Object.keys(val)) {
          const lowerK = k.toLowerCase();
          const isSens = sensitiveKeys.some(sk => lowerK.includes(sk));
          if (isSens) {
            logger.warn({ key: k }, 'FCM payload deep sanitization: Stripped sensitive key from nested object.');
            continue;
          }
          
          const nestedVal = val[k];
          if (typeof nestedVal !== 'object') {
            const stringifiedNestedVal = String(nestedVal);
            if (jwtRegex.test(stringifiedNestedVal.trim()) || emailRegex.test(stringifiedNestedVal.trim())) {
              logger.warn({ key: k }, 'FCM payload deep sanitization: Stripped sensitive pattern value from nested object.');
              continue;
            }
          }
          
          sanitizedObj[k] = sanitizeValue(nestedVal);
        }
        visited.delete(val);
        return sanitizedObj;
      }
      
      return val;
    };

    const sanitized = {};
    for (const key of Object.keys(data)) {
      if (data[key] !== undefined && data[key] !== null) {
        const lowerKey = key.toLowerCase();
        const isSensitiveKey = sensitiveKeys.some(sk => lowerKey.includes(sk));
        const val = data[key];

        let isJwt = false;
        let isEmail = false;
        if (typeof val !== 'object') {
          const valueStr = String(val);
          isJwt = jwtRegex.test(valueStr.trim());
          isEmail = emailRegex.test(valueStr.trim());
        }

        if (isSensitiveKey || isJwt || isEmail) {
          logger.warn(
            { key, isSensitiveKey, isJwt, isEmail },
            'FCM payload data sanitization: Stripped sensitive key/value from top-level data block.'
          );
          continue;
        }

        // Convert value to string format for FCM (stringifying objects/arrays after deep sanitization)
        if (typeof val === 'object') {
          const sanitizedVal = sanitizeValue(val);
          sanitized[key] = JSON.stringify(sanitizedVal);
        } else {
          sanitized[key] = String(val);
        }
      }
    }
    return sanitized;
  }

  async _sendMessage(message, token) {
    const serializedMessage = JSON.stringify(message);
    if (Buffer.byteLength(serializedMessage, 'utf8') > 4096) {
      throw new Error('FCM message payload size exceeds 4KB limit');
    }
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.post(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        { message },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: this.requestTimeout
        }
      );

      const messageId = response.data.name?.split('/').pop();
      logger.debug({ messageId }, 'FCM message sent successfully');
      return messageId;
    } catch (error) {
      return this._handleSendError(error, token);
    }
  }

  async _handleSendError(error, token) {
    const errorCode = error.response?.data?.error?.code;
    const errorMessage = error.response?.data?.error?.message || '';

    logger.error(
      {
        errorCode,
        errorMessage,
        tokenSuffix: token.slice(-10)
      },
      'FCM send error'
    );

    if (errorMessage.includes('UNREGISTERED') || errorCode === 404) {
      await DeviceToken.invalidateByToken(token, 'UNREGISTERED');
      logger.info({ token: token.slice(-10) }, 'Token invalidated as unregistered');
      throw new Error('Device token unregistered');
    }

    if (errorMessage.includes('INVALID_ARGUMENT') || errorCode === 3) {
      await DeviceToken.invalidateByToken(token, 'INVALID_ARGUMENT');
      logger.info({ token: token.slice(-10) }, 'Token invalidated as invalid');
      throw new Error('Invalid device token');
    }

    if (errorMessage.includes('MISMATCHED_CREDENTIAL') || errorCode === 5) {
      await DeviceToken.invalidateByToken(token, 'MISMATCHED_CREDENTIAL');
      logger.warn({ token: token.slice(-10) }, 'Token has mismatched credentials');
      throw new Error('Token credential mismatch');
    }

    throw new Error(`FCM error: ${errorMessage || 'Unknown error'}`);
  }

  async _handleSendErrors(errors) {
    const unregisteredTokens = errors
      .filter(e => e.error.includes('unregistered') || e.error.includes('UNREGISTERED'))
      .map(e => e.token);

    if (unregisteredTokens.length > 0) {
      await Promise.all(
        unregisteredTokens.map(token =>
          DeviceToken.invalidateByToken(token, 'UNREGISTERED')
        )
      );
      logger.info({ count: unregisteredTokens.length }, 'Cleaned up unregistered tokens');
    }
  }

  async pruneInvalidTokens() {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping pruning invalid tokens.');
      return { deletedCount: 0 };
    }
    try {
      const staleDays = parseInt(process.env.FCM_TOKEN_STALE_DAYS || '90', 10);
      const result = await DeviceToken.cleanupInvalidTokens(staleDays);
      logger.info({ deletedCount: result.deletedCount }, 'Invalid tokens pruned');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Error pruning tokens');
      throw error;
    }
  }

  async getTokenStats() {
    if (!this.isEnabled) {
      logger.warn('FCM service is disabled. Skipping fetching token stats.');
      return { totalTokens: 0, activeTokens: 0, inactiveTokens: 0, byDeviceType: {} };
    }
    try {
      const total = await DeviceToken.countDocuments();
      const active = await DeviceToken.countDocuments({ isActive: true });
      const byDevice = await DeviceToken.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$deviceType', count: { $sum: 1 } } }
      ]);

      return {
        totalTokens: total,
        activeTokens: active,
        inactiveTokens: total - active,
        byDeviceType: byDevice.reduce(
          (acc, doc) => {
            acc[doc._id] = doc.count;
            return acc;
          },
          {}
        )
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Error fetching token stats');
      throw error;
    }
  }
}

module.exports = new FcmService();
