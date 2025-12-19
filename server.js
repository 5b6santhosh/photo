// require('dotenv').config();
// const express = require('express');
// const mongoose = require('mongoose');
// const bodyParser = require('body-parser');
// const authRoutes = require('./routes/auth');

// const cors = require('cors');
// const path = require('path');
// const fs = require('fs');

// const app = express();
// const uploadRoutes = require('./routes/uploads');
// const homeRoutes = require('./routes/home');

// app.use(express.json());
// app.use('/api/home', homeRoutes);
// app.use('/api/contest', require('./routes/contestParticipation'));
// app.use('/api/likes', require('./routes/likes'));
// app.use('/api/saves', require('./routes/saves'));
// app.use('/api/reports', require('./routes/reports'));
// app.use('/api/admin/contest', require('./routes/adminContests'));
// app.use('/api/contest/results', require('./routes/contestResults'));

// // serve static uploads (optional)
// app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')))


// app.use(bodyParser.json());

// // MongoDB connection
// //metro.proxy.rlwy.net:38992/userdb
// //mongodb://mongo:tWnrBkLKRCdsWvKqLPgbXOXlyoCADRVE@metro.proxy.rlwy.net:38992
// //const live="mongodb://mongo:tWnrBkLKRCdsWvKqLPgbXOXlyoCADRVE@metro.proxy.rlwy.net:38992";
// const live = "mongodb://localhost:27017/userdb";

// mongoose.connect(live, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// }).then(() => console.log('MongoDB connected'))
//   .catch(err => console.log(err));

// // Routes
// app.use('/api/auth', authRoutes);


// app.use('/api/uploads', uploadRoutes);

// // Serve static HTML files from "public" folder
// app.use(express.static(path.join(__dirname, 'public')));


// // Default route (optional)
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// // Start server
// app.listen(3000, () => {
//   console.log('Server running on port 3000');
// });
// //password:-noJGlrsa0DlIOgPR


require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Static Files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Routes - Keep them organized
app.use('/api/auth', require('./routes/auth'));
app.use('/api/home', require('./routes/home'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/contest', require('./routes/contestParticipation'));
app.use('/api/likes', require('./routes/likes'));

// Database Connection
const dbURI = process.env.MONGO_URI || "mongodb://localhost:27017/userdb";
mongoose.connect(dbURI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('DB connection error:', err));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});