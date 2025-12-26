

// require('dotenv').config();
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const path = require('path');

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json({ limit: '50mb' })); // Increase if uploading large files
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// const authRoutes = require('./routes/auth');
// const homeRoutes = require('./routes/home');
// const uploadRoutes = require('./routes/uploads');
// const participationRoutes = require('./routes/contestParticipation');
// const likeRoutes = require('./routes/likes');
// const eventStoriesRoutes = require('./routes/eventStories');
// const adminEventsRouter = require('./routes/admin/events'); // Check folder 'admin'
// const contestStoriesRouter = require('./routes/contestStories');

// // === API Routes (MUST come BEFORE static serving) ===

// app.use(express.json());

// // serve static uploads (optional)
// app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')))

// app.use((err, req, res, next) => {
//   if (err.message === 'Only PNG and JPG images are allowed') {
//     return res.status(400).json({ message: err.message });
//   }
//   next(err);
// });

// // app.use(bodyParser.json());
// app.use(express.json());

// // === 3. MongoDB Connection (FIXED: Only one connection) ===
// // Priority: Use process.env.MONGO_URI if available, otherwise fallback to hardcoded live string
// console.log(process.env.MONGO_URI);
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB connected successfully'))
//   .catch(err => console.error('MongoDB connection error:', err));

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/home', homeRoutes);
// app.use('/api/uploads', uploadRoutes);
// app.use('/api/contest', participationRoutes);
// app.use('/api/likes', likeRoutes);
// app.use('/api/events', eventStoriesRoutes);
// app.use('/api/admin/events', adminEventsRouter);
// app.use('/api/contests', contestStoriesRouter);
// app.use('/api/search', require('./routes/search'));
// app.use('/api/reels', require('./routes/reels'));

// // Add other API routes here...

// // === Serve uploaded files ===
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// // === Serve static files from public folder ===
// // This will serve file.html at root: http://your-app.up.railway.app/
// app.use(express.static(path.join(__dirname, 'public')));

// // === Specific route for your upload page (optional but safe) ===
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'file.html'));
// });

// // === 404 handler (optional, for clean errors) ===
// app.use((req, res) => {
//   res.status(404).json({ message: 'Route not found' });
// });

// // Database Connection
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB connected'))
//   .catch(err => console.error('DB connection error:', err));

// // Use Railway's dynamic port
// const PORT =
//    process.env.PORT 
//   // || 
//   // 5000;
//   // "https://photo-production-4173.up.railway.app";
// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`Server running on port ${PORT}`);
// });

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/home', require('./routes/home'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/contest', require('./routes/contestParticipation'));
app.use('/api/likes', require('./routes/likes'));
app.use('/api/events', require('./routes/eventStories'));
app.use('/api/admin/events', require('./routes/admin/events'));
app.use('/api/contests', require('./routes/contestStories'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/contest-submissions', require('./routes/contestSubmissions'));

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
//process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server successfully listening on port ${PORT} (Railway assigned port)`);
});