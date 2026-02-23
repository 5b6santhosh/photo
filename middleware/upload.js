// ============================================
// SECURE FILE UPLOAD MIDDLEWARE
// ============================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configuration
const UPLOAD_CONFIG = {
    maxSizeMB: 50,
    supportedFormats: {
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        video: ['mp4', 'mov', 'avi', 'webm', 'mkv']
    }
};

// Custom storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Generate unique filename to prevent overwrites
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${Date.now()}_${uniqueSuffix}${ext}`;
        cb(null, filename);
    }
});

// File filter for security
const fileFilter = (req, file, cb) => {
    // Check MIME type
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');

    if (!isImage && !isVideo) {
        return cb(new Error('Only image and video files are allowed'), false);
    }

    // Check file extension
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const isImageExt = UPLOAD_CONFIG.supportedFormats.image.includes(ext);
    const isVideoExt = UPLOAD_CONFIG.supportedFormats.video.includes(ext);

    if (!isImageExt && !isVideoExt) {
        return cb(
            new Error(`Unsupported file extension: ${ext}. Allowed: ${[...UPLOAD_CONFIG.supportedFormats.image, ...UPLOAD_CONFIG.supportedFormats.video].join(', ')
                }`),
            false
        );
    }

    // MIME type and extension must match
    if (isImage && !isImageExt) {
        return cb(new Error('File extension does not match MIME type'), false);
    }
    if (isVideo && !isVideoExt) {
        return cb(new Error('File extension does not match MIME type'), false);
    }

    cb(null, true);
};

// Create multer instance
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: UPLOAD_CONFIG.maxSizeMB * 1024 * 1024, // Convert MB to bytes
        files: 1 // Only allow single file upload
    }
});

// Error handling middleware
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: `File too large. Maximum size: ${UPLOAD_CONFIG.maxSizeMB}MB`
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Only one file allowed per upload'
            });
        }
        return res.status(400).json({
            success: false,
            error: `Upload error: ${err.message}`
        });
    }

    if (err) {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }

    next();
};

module.exports = {
    upload,
    handleUploadError,
    UPLOAD_CONFIG
};