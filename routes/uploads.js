// routes/uploads.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path'); // Optional, for better path handling
const FileMeta = require('../models/FileMeta');
const { uploadToProvider } = require('../services/storageService');
const apiKeyAuth = require('../middleware/apiKeyAuth');

const router = express.Router();

// Use temp storage
const upload = multer({ dest: 'temp/' });
// Apply API-key auth for everything below

router.use(apiKeyAuth);

router.post('/', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    tempFilePath = req.file.path; // Save path for cleanup

    const allowedTypes = ['image/png', 'image/jpeg', 'video/mp4'];

    if (!allowedTypes.includes(req.file.mimetype)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Only PNG and JPG images are allowed' });
    }

    const cloudFile = await uploadToProvider(req.file); // This deletes the file internally

    const meta = new FileMeta({
      fileName: cloudFile.publicId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: cloudFile.url,
      cloudId: cloudFile.publicId,
      isVideo: req.file.mimetype.startsWith('video/'),
      thumbnailUrl: cloudFile.thumbnailUrl || null,
      isCurated: false,
      createdBy: req.headers['x-user-id'] || 'anonymous',
      description: req.body.description
    });

    await meta.save();

    res.status(201).json({
      message: 'File uploaded successfully',
      file: meta
    });

  } catch (error) {
    console.error('Upload error:', error);

    // Clean up temp file if it still exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Cleanup failed:', cleanupError.message);
      }
    }

    res.status(500).json({
      message: 'Upload failed',
      error: error.message
    });

  } finally {
    // Ensure cleanup on exit
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        // Ignore — just log if needed
      }
    }
  }
});

// POST /api/uploads/image
router.post('/image', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    tempFilePath = req.file.path;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      return res.status(400).json({ message: 'Invalid file type. Only images are allowed.' });
    }

    const cloudFile = await uploadToProvider(req.file);

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: cloudFile.url,
        publicId: cloudFile.publicId,
        mimeType: req.file.mimetype,
        size: req.file.size
      }
    });

  } catch (error) {
    console.error('Common Upload Error:', error);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) { }
    }
    res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
  }
});

module.exports = router;