const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Temp_signup = require('../models/Temp_signup');

const mailService = require("../services/mail.service");
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const TokenBlacklist = require('../models/TokenBlacklist');

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

router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered"
      });
    }

    const existingTemp = await Temp_signup.findOne({ email });

    // Resend cooldown (60 seconds)
    if (existingTemp && existingTemp.lastOtpSentAt) {
      const secondsSinceLastOtp =
        (Date.now() - existingTemp.lastOtpSentAt.getTime()) / 1000;

      if (secondsSinceLastOtp < 60) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${Math.ceil(60 - secondsSinceLastOtp)} seconds before requesting new OTP`
        });
      }
    }

    await Temp_signup.deleteOne({ email });

    const hashedPassword = await bcrypt.hash(password, 12);

    const plainOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = await bcrypt.hash(plainOTP, 10);

    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Temp_signup.create({
      username,
      email,
      password: hashedPassword,
      otp: hashedOTP,
      otpExpiresAt,
      otpAttempts: 0,
      lastOtpSentAt: new Date()
    });

    // await mailService.sendMail({
    //   to: email,
    //   subject: "Activate Your Photo Curator Account",
    //   html: `
    //     <h2>Welcome to Photo Curator 📸</h2>
    //     <p>Your OTP is:</p>
    //     <h1>${plainOTP}</h1>
    //     <p>This code expires in 5 minutes.</p>
    //   `
    // });
    try {
      await mailService.sendMail({
        to: email,
        subject: "Activate Your Photo Curator Account",
        html: `
      <h2>Welcome to Photo Curator 📸</h2>
      <p>Your OTP is:</p>
      <h1>${plainOTP}</h1>
      <p>This code expires in 5 minutes.</p>
    `
      });

      console.log(`OTP email sent to ${email}`);

      return res.status(200).json({
        success: true,
        message: "OTP sent to your email"
      });

    } catch (mailError) {
      console.error("Failed to send OTP email:", mailError);

      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email. Please try again."
      });
    }

  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({
      success: false,
      message: "Signup failed. Please try again."
    });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const tempUser = await Temp_signup.findOne({ email });

    if (!tempUser) {
      return res.status(400).json({
        success: false,
        message: "Invalid request"
      });
    }

    //  Too many attempts protection
    if (tempUser.otpAttempts >= 5) {
      await Temp_signup.deleteOne({ _id: tempUser._id });
      return res.status(403).json({
        success: false,
        message: "Too many failed attempts. Please signup again."
      });
    }

    //  Expiry check
    if (tempUser.otpExpiresAt < new Date()) {
      await Temp_signup.deleteOne({ _id: tempUser._id });
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    const isValid = await bcrypt.compare(otp, tempUser.otp);

    if (!isValid) {
      tempUser.otpAttempts += 1;
      await tempUser.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Create actual user
    const newUser = await User.create({
      username: tempUser.username,
      email: tempUser.email,
      password: tempUser.password,
      isActive: true,
      badgeTier: "newCurator"
    });

    await Temp_signup.deleteOne({ _id: tempUser._id });

    //  AUTO LOGIN TOKEN (Better UX)
    const token = jwt.sign(
      {
        userId: newUser._id.toString(),
        email: newUser.email,
        role: newUser.role || "user",
        badgeTier: newUser.badgeTier
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      message: "Account activated successfully",
      token,
      user: {
        id: newUser._id,
        email: newUser.email,
        username: newUser.username,
        role: newUser.role,
        badgeTier: newUser.badgeTier
      }
    });

  } catch (err) {
    console.error("Verify Error:", err);
    res.status(500).json({
      success: false,
      message: "Verification failed"
    });
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

    // Update last login timestamp (auditing only)
    user.login_date = new Date();
    await user.save();

    // GENERATE JWT TOKEN (7-day expiry)
    const token = jwt.sign(
      {
        userId: user._id.toString(), // Critical: stringify ObjectId
        email: user.email,
        role: user.role || 'user',
        badgeTier: user.badgeTier || 'newCurator'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // RETURN TOKEN + SANITIZED USER DATA
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        badgeTier: user.badgeTier,
        isProfileCompleted: user.isProfileCompleted
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/* =======================
   PROTECTED ROUTES
======================= */

// Apply API-key auth for everything below
//router.use(apiKeyAuth);

// Get users
router.get('/getusers', authMiddleware, requireAdmin, async (req, res) => {
  try {
    // EXCLUDE SENSITIVE FIELDS
    const users = await User.find({}, '-password -apikey -__v').lean();
    res.status(200).json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


// Update user
router.put('/update/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // 🔒 CRITICAL: Ownership/Admin validation
    if (req.user.id !== id && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'You can only update your own profile'
      });
    }

    const { username, email } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { username, email },
      {
        new: true,
        runValidators: true,
        select: '-password -apikey -__v' // Exclude sensitive fields
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * POST /api/auth/logout
 * Logout user and blacklist token
 */
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.token;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "No token provided"
      });
    }

    // Decode to get expiry
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.exp) {
      return res.status(400).json({
        success: false,
        message: "Invalid token"
      });
    }

    // Check if already blacklisted (idempotent)
    const existing = await TokenBlacklist.findOne({ token });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Already logged out"
      });
    }

    await TokenBlacklist.create({
      token,
      expiresAt: new Date(decoded.exp * 1000)
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "Logout failed"
    });
  }
});

/**
 * DELETE /api/auth/delete-account
 * Delete user account with password confirmation
 */
router.delete('/delete-account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.token;
    const { password } = req.body; // Require password confirmation

    // Validate password confirmation
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password confirmation required"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Verify password before deletion
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    // Delete user
    await User.deleteOne({ _id: userId });

    // Blacklist token (force logout)
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      await TokenBlacklist.create({
        token,
        expiresAt: new Date(decoded.exp * 1000)
      });
    }

    res.status(200).json({
      success: true,
      message: "Account deleted successfully"
    });

  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete account"
    });
  }
});

router.patch('/promote/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role: 'admin', badgeTier: 'master' },
      { new: true }
    ).select('-password');

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
