require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const redis = require('./services/redis');
const cors = require('cors');
const path = require('path');

const app = express();

// Debug: Show environment variables (without sensitive values)
console.log('Environment check:');
console.log('PORT from Railway:', process.env.PORT);
console.log('MONGO_URI exists?', !!process.env.MONGO_URI);
console.log('BASE_URL:', process.env.BASE_URL);

// Middleware
app.use(cors());
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/razorpay', require('./routes/razorpayWebhook'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/home', require('./routes/home'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/likes', require('./routes/likes'));
app.use('/api/events', require('./routes/eventStories'));
app.use('/api/admin/events', require('./routes/admin/createAdminEvents'));
app.use('/api/contests', require('./routes/contestStories'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/contest-submissions', require('./routes/userContestSubmissions'));
app.use('/api/shares', require('./routes/shares'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/payments', require('./routes/payments'));


// Static files
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'file.html'));
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// ── MongoDB ────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('FATAL: MONGO_URI is missing in environment variables!');
  process.exit(1);
}

console.log('Attempting MongoDB connection...');
mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 7500 })
  .then(() => {
    console.log('✓ MongoDB connected successfully');
  })
  .catch((err) => {
    console.error('MongoDB connection FAILED:', err.message);
    process.exit(1);
  });

// ── Start Server ───────────────────────────────────────────
// Near the bottom, replace the port part with:

const PORT = 5000;
// const PORT = process.env.PORT || 10000;
//process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server successfully listening on port ${PORT} (Railway assigned port)`);
});
