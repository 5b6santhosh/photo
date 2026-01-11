const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Temp_signup  = require('../models/Temp_signup');

const apiKeyAuth = require('../middleware/apiKeyAuth');

const mailService = require("../services/mail.service");

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
//temp registraion
router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: 'User already exists'
      });
    }

    // 2️⃣ Remove old temp signup (resend case)
    await Temp_signup.deleteOne({ email });

    // 3️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Generate OTP
    const plainOTP = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedOTP = await bcrypt.hash(plainOTP, 10);

    // 5️⃣ OTP expiry (5 minutes)
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 6️⃣ Save temp user
    const tempUser = new Temp_signup({
      username,
      email,
      password: hashedPassword,
      otp: hashedOTP,
      otpExpiresAt
    });

    await tempUser.save();

    // Send OTP email (PLAIN OTP ONLY)
    await mailService.sendMail({
      to: email,
      subject: "Your OTP",
      text: `Your OTP is ${plainOTP}`,
      html: `<h3>Your OTP: ${plainOTP}</h3>`,
    });


    res.status(201).json({
      status: true,
      message: 'Please check your email to activate your account',
    });

  } catch (err) {
    console.error("Signup Error:", err); //  see terminal

    res.status(500).json({
      status: false,
      message: err.message,   //  return actual error
      error: err              //  optional (remove in prod)
    });
  }
});



router.post('/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const tempUser = await Temp_signup.findOne({ email });
    if (!tempUser) {
      return res.status(400).json({ message: "User not found" });
    }

    // Expiry check
    if (tempUser.otpExpiresAt < new Date()) {
      await Temp_signup.deleteOne({ _id: tempUser._id });
      return res.status(400).json({ message: "OTP expired" });
    }

    // OTP match
    const isValid = await bcrypt.compare(otp, tempUser.otp);
    if (!isValid) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Create user
    const newUser = await User.create({
      username: tempUser.username,
      email: tempUser.email,
      password: tempUser.password,
      isActive: true,
    });

    // Delete temp record
    await Temp_signup.deleteOne({ _id: tempUser._id });

    res.status(201).json({
      status: true,
      message: "Your account activated successfully",
    });

  } catch (err) {
    console.error(err);
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
    user.login_date = new Date();

    
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
//router.use(apiKeyAuth);

// Get users
router.get('/getusers', apiKeyAuth,async (req, res) => {
  const users = await User.find({}, '-password');
  res.status(200).json(users);
});

// Update user
router.put('/update/:id',apiKeyAuth,async (req, res) => {
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
