const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FileMeta = require('../models/FileMeta');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer storage: timestamp + original name (or use uuid)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10) }, // default 50MB
});

// --- Create (upload) ---
/**
 * POST /api/uploads
 * form-data: file (single), description (optional)
 * for demo: createdBy taken from header 'x-user-id' OR req.user.id if using auth middleware
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    console.log('FILE:', req.file);
    console.log('BODY:', req.body);

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const createdBy = req.headers['x-user-id'] || 'anonymous';
    const meta = new FileMeta({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: path.join(UPLOAD_DIR, req.file.filename),
      description: req.body.description,
      createdBy
    });

    await meta.save();
    return res.status(201).json({ message: 'File uploaded', file: meta });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({
      message: 'Upload failed',
      error: err && err.message ? err.message : 'Internal Server Error'
    });
  }
});


// --- List (with optional paging) ---
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      FileMeta.find({ archived: false }).sort({ uploadedAt: -1 }).skip(skip).limit(limit).lean(),
      FileMeta.countDocuments({ archived: false })
    ]);

    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Get metadata ---
router.get('/:id', async (req, res) => {
  try {
    const f = await FileMeta.findById(req.params.id).lean();
    if (!f) return res.status(404).json({ message: 'Not found' });
    res.json(f);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Download file ---
router.get('/:id/download', async (req, res) => {
  try {
    const f = await FileMeta.findById(req.params.id);
    if (!f) return res.status(404).json({ message: 'Not found' });

    const fullPath = path.resolve(f.path); // or path.join(process.cwd(), f.path) depending on how you stored it
    if (!fs.existsSync(fullPath)) return res.status(410).json({ message: 'File missing' });

    res.download(fullPath, f.originalName);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Update metadata or replace file ---
router.patch('/:id', async (req, res, next) => {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType.startsWith('multipart/form-data')) {
    // replace file
    upload.single('file')(req, res, async err => {
      if (err) return res.status(400).json({ message: err.message });
      try {
        const meta = await FileMeta.findById(req.params.id);
        if (!meta) return res.status(404).json({ message: 'Not found' });

        // remove old file (optional)
        const old = path.resolve(meta.path);
        if (fs.existsSync(old)) fs.unlinkSync(old);

        // set new file fields
        meta.fileName = req.file.filename;
        meta.originalName = req.file.originalname;
        meta.mimeType = req.file.mimetype;
        meta.size = req.file.size;
        meta.path = path.join(UPLOAD_DIR, req.file.filename);
        meta.updatedBy = req.headers['x-user-id'] || (req.user && req.user.id) || 'anonymous';
        if (req.body.description) meta.description = req.body.description;
        await meta.save();
        res.json({ message: 'File replaced', file: meta });
      } catch (e) { next(e); }
    });
  } else {
    // update metadata only (JSON)
    try {
      const meta = await FileMeta.findById(req.params.id);
      if (!meta) return res.status(404).json({ message: 'Not found' });

      const { description, archived } = req.body;
      if (description !== undefined) meta.description = description;
      if (archived !== undefined) meta.archived = !!archived;
      meta.updatedBy = req.headers['x-user-id'] || (req.user && req.user.id) || 'anonymous';
      await meta.save();
      res.json({ message: 'Updated', file: meta });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
});

// --- Delete (remove metadata + file) ---
router.delete('/:id', async (req, res) => {
  try {
    const meta = await FileMeta.findById(req.params.id);
    if (!meta) return res.status(404).json({ message: 'Not found' });

    // delete file from disk
    const p = path.resolve(meta.path);
    if (fs.existsSync(p)) fs.unlinkSync(p);

    await meta.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
