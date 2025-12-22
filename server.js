// require('dotenv').config();
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const path = require('path');

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json());

// // Static Files
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// app.use(express.static(path.join(__dirname, 'public')));

// // Routes - Keep them organized
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/home', require('./routes/home'));
// app.use('/api/uploads', require('./routes/uploads'));
// app.use('/api/contest', require('./routes/contestParticipation'));
// app.use('/api/likes', require('./routes/likes'));

// // Database Connection
// const dbURI = process.env.MONGO_URI;
// //|| "mongodb://localhost:27017/userdb";
// mongoose.connect(dbURI)
//   .then(() => console.log('MongoDB connected'))
//   .catch(err => console.error('DB connection error:', err));

// app.listen(3000, () => {
//   console.log('Server running on http://localhost:3000');
// });


require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase if uploading large files
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// === API Routes (MUST come BEFORE static serving) ===
app.use('/api/auth', require('./routes/auth'));
app.use('/api/home', require('./routes/home'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/contest', require('./routes/contestParticipation'));
app.use('/api/likes', require('./routes/likes'));
// Add other API routes here...

// === Serve uploaded files ===
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === Serve static files from public folder ===
// This will serve file.html at root: http://your-app.up.railway.app/
app.use(express.static(path.join(__dirname, 'public')));

// === Specific route for your upload page (optional but safe) ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'file.html'));
});

// === 404 handler (optional, for clean errors) ===
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Database Connection
const dbURI = "mongodb+srv://photoCurator:24101997@photocurator.7wecrld.mongodb.net/?appName=PhotoCurator";
//process.env.MONGO_URI;
mongoose.connect(dbURI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('DB connection error:', err));

// Use Railway's dynamic port
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});