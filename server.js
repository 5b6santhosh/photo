

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

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Routes ───────────────────────────────────────────────────
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

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));

// Serve frontend (public folder)
app.use(express.static(path.join(__dirname, 'public')));

// Root route → serve your main HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'file.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler (basic version)
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err.message === 'Only PNG and JPG images are allowed') {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({ message: 'Something went wrong on the server' });
});

// ── MongoDB Connection (ONLY ONCE!) ──────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('CRITICAL ERROR: MONGO_URI is not defined in environment variables!');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✓ MongoDB connected successfully'))
  .catch((err) => {
    console.error('MongoDB connection FAILED:', err.message);
    process.exit(1);
  });

// ── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});