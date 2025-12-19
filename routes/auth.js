const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const router = express.Router();

// Register route
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email});
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    // Generate API key
    const { v4: uuidv4 } = await import('uuid');
    const apiKey = uuidv4();

    //const users = await User.find({ apikey: { $exists: false } });

    user.apikey=apiKey;
    await user.save();
    console.log(user); // will include apiKey: undefined

    res.status(200).json({ message: 'Login successful', user: { username: user.username, email: user.email,key:user.apikey,msg:user} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/getusers',async(req,res)=>{
  try{
    const users=await User.find({},'-password');
    res.status(200).json(users);
  }catch(err){
    res.status(500).json({error:err.message})
  }
})

// Update user details
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email } = req.body;

  try {
    // Find and update user
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { username, email },
      { new: true, runValidators: true }
    );

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;