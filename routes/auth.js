const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const apiKeyAuth = require('../middleware/apiKeyAuth');

const router = express.Router();

/* =======================
   PUBLIC ROUTES
======================= */

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login (generates API key)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Generate API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    user.apikey = apiKey;
    await user.save();

    res.status(200).json({
      message: 'Login successful',
      apiKey: apiKey
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   PROTECTED ROUTES
======================= */

// Apply API-key auth for everything below
router.use(apiKeyAuth);

// Get users
router.get('/getusers', async (req, res) => {
  const users = await User.find({}, '-password');
  res.status(200).json(users);
});

// Update user
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email } = req.body;

  const updatedUser = await User.findByIdAndUpdate(
    id,
    { username, email },
    { new: true, runValidators: true }
  );

  if (!updatedUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.status(200).json({
    message: 'User updated successfully',
    user: updatedUser
  });
});

module.exports = router;
