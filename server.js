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

const app = express();

// ============================================
// ENVIRONMENT & CONFIG CHECK
// ============================================

console.log(' Environment check:');
console.log('PORT from Railway:', process.env.PORT);
console.log('MONGO_URI exists?', !!process.env.MONGO_URI);
console.log('BASE_URL:', process.env.BASE_URL);

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

app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// ============================================
// RATE LIMITING
// ============================================

const evaluationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.RATE_LIMIT_EVALUATE) || 100,
  message: {
    success: false,
    error: 'Too many evaluation requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development'
});

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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// ROUTES - EXISTING APPLICATION
// ============================================

app.use('/api/webhooks/razorpay', require('./routes/razorpayWebhook'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));

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

app.use('/api/admin/events', require('./routes/admin/createAdminEvents'));

app.use('/api/payments', require('./routes/payments'));

// ============================================
// ROUTES - MEDIA EVALUATION (NEW)
// ============================================

app.use('/api/media/evaluate', evaluationLimiter);
app.use('/api/media/appeals', appealsLimiter);

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

app.get('/api', (req, res) => {
  res.json({
    service: 'Photocuratore API',
    version: '2.0.0',
    status: 'running',
    features: {
      mediaEvaluation: true,
      aiEnabled: !!process.env.GEMINI_API_KEY,
      phase2: process.env.ENABLE_PHASE2 !== 'false'
    },
    endpoints: {
      auth: '/api/auth',
      contests: '/api/contests',
      submissions: '/api/contest-submissions',
      mediaEvaluation: '/api/media/evaluate',
      contestWinners: '/api/media/contests/:contestId/winners',
      appeals: '/api/media/appeals'
    }
  });
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

app.use((err, req, res, next) => {
  console.error(' Global error:', err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: Object.values(err.errors).map(e => e.message)
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: `Invalid ${err.path}: ${err.value}`
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token'
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`
    });
  }

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

console.log(' Attempting MongoDB connection...');
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 7500
  })
  .then(() => {
    console.log(' MongoDB connected successfully');
    console.log(` Database: ${mongoose.connection.name}`);
  })
  .catch((err) => {
    console.error(' MongoDB connection FAILED:', err.message);
    process.exit(1);
  });

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

const CONFIG = require('./config');

// Priority: Railway PORT env var → config → fallback 5000
// Never hardcode 3000 — let Railway assign the port dynamically
const PORT = process.env.PORT || CONFIG.port || 5000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Photocuratore API Server');
  console.log('='.repeat(60));
  console.log(`📡 Server listening on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Base URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`🤖 AI Phase-2: ${process.env.ENABLE_PHASE2 !== 'false' ? 'Enabled' : 'Disabled'}`);
  console.log('='.repeat(60) + '\n');
});

// ── Handle port-in-use error gracefully ──────────────────────────────────────
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error('Fix options:');
    console.error(`  1. Kill the process using the port:  lsof -ti:${PORT} | xargs kill -9`);
    console.error(`  2. Set a different port in your .env file: PORT=5001`);
    process.exit(1);
  } else {
    console.error(' Server error:', err);
    process.exit(1);
  }
});

module.exports = app;