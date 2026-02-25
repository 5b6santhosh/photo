// ============================================
// APPLICATION CONFIGURATION
// ============================================

require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
    'JWT_SECRET',
    'MONGO_URI'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    throw new Error(
        `Missing required environment variables: ${missingVars.join(', ')}\n` +
        'Please check your .env file'
    );
}

const APP_CONFIG = {
    // Server
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI,

    // Authentication
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiry: process.env.JWT_EXPIRY || '7d',

    // Thresholds
    phase1Threshold: Number(process.env.PHASE1_THRESHOLD) || 65,
    duplicateHashThreshold: Number(process.env.DUPLICATE_HASH_THRESHOLD) || 10,

    // Video settings
    maxDuration: Number(process.env.MAX_DURATION) || 60, // seconds
    maxSizeMB: Number(process.env.MAX_SIZE_MB) || 50, // MB
    minResolution: {
        width: Number(process.env.MIN_WIDTH) || 720,
        height: Number(process.env.MIN_HEIGHT) || 1280
    },

    // File formats
    supportedFormats: {
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        video: ['mp4', 'mov', 'avi', 'webm', 'mkv']
    },

    // Quality scoring weights
    scoring: {
        resolution: {
            excellent: 2000000, // pixels
            good: 800000
        },
        sharpness: {
            good: 15, // standard deviation
            poor: 5
        },
        brightness: {
            min: 50,
            max: 200
        },
        fps: {
            good: 24
        },
        bitrate: {
            good: 2000000 // bits per second
        }
    },

    // File cleanup
    tempFileRetention: Number(process.env.TEMP_FILE_RETENTION) || 5000, // ms

    // Rate limiting (requests per hour)
    rateLimit: {
        evaluate: Number(process.env.RATE_LIMIT_EVALUATE) || 100,
        appeals: Number(process.env.RATE_LIMIT_APPEALS) || 10
    },

    // Fraud detection
    fraud: {
        lowConfidenceThreshold: 75,
        highSkinThreshold: 45,
        judgeOverridePenalty: 30
    }
};

// Validation
if (APP_CONFIG.nsfwThreshold < 0 || APP_CONFIG.nsfwThreshold > 1) {
    throw new Error('NSFW_THRESHOLD must be between 0 and 1');
}

if (APP_CONFIG.maxSizeMB < 1 || APP_CONFIG.maxSizeMB > 500) {
    throw new Error('MAX_SIZE_MB must be between 1 and 500');
}

module.exports = APP_CONFIG;