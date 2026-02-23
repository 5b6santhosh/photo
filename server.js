// ============================================
// PHOTOCURATORE - MERGED APPLICATION
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const redis = require('./services/redis');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');

const app = express();

// ============================================
// ENVIRONMENT & CONFIG CHECK
// ============================================

console.log(' Environment check:');
console.log('PORT from Railway:', process.env.PORT);
console.log('MONGO_URI exists?', !!process.env.MONGO_URI);
console.log('BASE_URL:', process.env.BASE_URL);
console.log('HF_TOKEN exists?', !!process.env.HF_TOKEN);

// Validate critical environment variables
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error(` FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet for security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// ============================================
// RATE LIMITING
// ============================================

// Rate limiter for media evaluation
const evaluationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.RATE_LIMIT_EVALUATE) || 100,
  message: {
    success: false,
    error: 'Too many evaluation requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development' // Skip in dev
});

async function warmupModels() {
  if (!process.env.HF_TOKEN) {
    console.warn('⚠ HF_TOKEN missing — skipping model warmup');
    return;
  }

  if (!process.env.HF_NSFW_ENDPOINT) {
    console.log(' No HF_NSFW_ENDPOINT configured — skipping NSFW warmup');
    console.log('Set HF_NSFW_ENDPOINT to your Inference Endpoint URL');
    return;
  }

  const axios = require('axios');
  const token = process.env.HF_TOKEN.trim();

  console.log('🔥 Warming up HuggingFace models...');

  try {
    const dummyImage = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
      'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB' +
      'AxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAA' +
      'AAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABmX/9k=',
      'base64'
    );

    await axios.post(
      process.env.HF_NSFW_ENDPOINT,
      dummyImage,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        timeout: 30000
      }
    );

    console.log('NSFW model warmed up (Inference Endpoint)');
  } catch (err) {
    console.warn('⚠ NSFW warmup failed:', err.response?.status || err.message);
  }
}
// Rate limiter for appeals
const appealsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.RATE_LIMIT_APPEALS) || 10,
  message: {
    success: false,
    error: 'Too many appeal requests. Please try again later.'
  }
});

// ============================================
// BODY PARSING MIDDLEWARE
// ============================================

// Special handling for Razorpay webhooks (must be BEFORE json parsing)
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));

// Standard body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// ROUTES - EXISTING APPLICATION
// ============================================

// Webhook routes (must be first, before other routes)
app.use('/api/webhooks/razorpay', require('./routes/razorpayWebhook'));

// Authentication & User routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));

// Content routes
app.use('/api/home', require('./routes/home'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/likes', require('./routes/likes'));
app.use('/api/events', require('./routes/eventStories'));
app.use('/api/contests', require('./routes/contestStories'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/contest-submissions', require('./routes/userContestSubmissions'));
app.use('/api/shares', require('./routes/shares'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/contest', require('./routes/contestDetails'));

// Admin routes
app.use('/api/admin/events', require('./routes/admin/createAdminEvents'));

// Payment routes
app.use('/api/payments', require('./routes/payments'));

// ============================================
// ROUTES - MEDIA EVALUATION (NEW)
// ============================================

// Apply rate limiters to specific media evaluation routes
app.use('/api/media/evaluate', evaluationLimiter);
app.use('/api/media/appeals', appealsLimiter);

// Media evaluation & contest ranking routes
app.use('/api/media', require('./routes/contest.routes'));
// app.use('/api', require('./routes/contestRanking'));

// ============================================
// STATIC FILES
// ============================================

app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// ROOT ENDPOINT
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'file.html'));
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    service: 'Photocuratore API',
    version: '2.0.0',
    status: 'running',
    features: {
      mediaEvaluation: true,
      aiEnabled: !!process.env.HF_TOKEN,
      phase2: process.env.ENABLE_PHASE2 !== 'false'
    },
    endpoints: {
      // Existing endpoints
      auth: '/api/auth',
      contests: '/api/contests',
      submissions: '/api/contest-submissions',
      // New media evaluation endpoints
      mediaEvaluation: '/api/media/evaluate',
      contestWinners: '/api/media/contests/:contestId/winners',
      appeals: '/api/media/appeals'
    }
  });
});

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(' Global error:', err);

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: Object.values(err.errors).map(e => e.message)
    });
  }

  // Mongoose cast errors (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: `Invalid ${err.path}: ${err.value}`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token'
    });
  }

  // Multer errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && {
      error: err.message,
      stack: err.stack
    })
  });
});

// ============================================
// DATABASE CONNECTION
// ============================================

const MONGO_URI = process.env.MONGO_URI;

console.log(' Attempting MongoDB connection...');
mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 7500
  })
  .then(() => {
    console.log(' MongoDB connected successfully');
    console.log(` Database: ${mongoose.connection.name}`);
    if (process.env.HF_TOKEN && process.env.ENABLE_PHASE2 !== 'false') {
      warmupModels();
    }

  })
  .catch((err) => {
    console.error(' MongoDB connection FAILED:', err.message);
    process.exit(1);
  });

// Handle MongoDB connection errors after initial connection
mongoose.connection.on('error', err => {
  console.error(' MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn(' MongoDB disconnected');
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = async (signal) => {
  console.log(`\n Received ${signal}, shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log(' HTTP server closed');

      try {
        await mongoose.connection.close();
        console.log(' MongoDB connection closed');
        process.exit(0);
      } catch (err) {
        console.error(' Error during shutdown:', err);
        process.exit(1);
      }
    });
  }

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error(' Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error(' Unhandled Promise Rejection:', err);
});

// ============================================
// START SERVER
// ============================================

// Railway assigns a PORT, fallback to 5000 for local dev
// const PORT = process.env.PORT || 5000;
const CONFIG = require('./config');
const PORT = CONFIG.port;


const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Photocuratore API Server');
  console.log('='.repeat(60));
  console.log(`📡 Server listening on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Base URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`🤖 AI Phase-2: ${process.env.ENABLE_PHASE2 !== 'false' ? 'Enabled' : 'Disabled'}`);
  console.log(`🔐 HF Token: ${process.env.HF_TOKEN ? 'Configured ✓' : 'Missing ✗'}`);
  console.log('='.repeat(60) + '\n');
});

module.exports = app;