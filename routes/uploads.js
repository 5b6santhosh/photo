


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

    const cloudFile = await uploadToProvider(req.file); // This deletes the file internally


    const allowedTypes = ['image/png', 'image/jpeg'];

      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ message: 'Only PNG and JPG images are allowed' });
      }

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

module.exports = router;