const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const authRoutes = require('./routes/auth');

const app = express();
app.use(bodyParser.json());

// MongoDB connection
//metro.proxy.rlwy.net:38992
//localhost:27017/userdb
mongoose.connect('mongodb://metro.proxy.rlwy.net:38992', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Routes
app.use('/api/auth', authRoutes);

// Start server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});