require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const authRoutes = require('./routes/auth');

const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const uploadRoutes = require('./routes/uploads');

app.use(express.json());

// serve static uploads (optional)
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')))


app.use(bodyParser.json());

// MongoDB connection
//metro.proxy.rlwy.net:38992/userdb
//mongodb://mongo:tWnrBkLKRCdsWvKqLPgbXOXlyoCADRVE@metro.proxy.rlwy.net:38992
//const live="mongodb://mongo:tWnrBkLKRCdsWvKqLPgbXOXlyoCADRVE@metro.proxy.rlwy.net:38992";
const live="mongodb://localhost:27017/userdb";

mongoose.connect(live, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Routes
app.use('/api/auth', authRoutes);


app.use('/api/uploads', uploadRoutes);

// Serve static HTML files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));


// Default route (optional)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
//password:-noJGlrsa0DlIOgPR