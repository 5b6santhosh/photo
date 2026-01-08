// // services/storageService.js
// const cloudinary = require('cloudinary').v2;
// const fs = require('fs');

// // Cloudinary Config (Use your credentials from .env)
// cloudinary.config({
//     cloud_name: process.env.CLOUDINARY_NAME,
//     api_key: process.env.CLOUDINARY_KEY,
//     api_secret: process.env.CLOUDINARY_SECRET
// });

// const uploadToProvider = async (file) => {
//     // OPTION A: CLOUDINARY (Use this now for $0 budget)
//     try {
//         const result = await cloudinary.uploader.upload(file.path, {
//             folder: 'app_uploads',
//             resource_type: 'auto'
//         });

//         // Delete local temp file after upload to Cloudinary
//         if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

//         return {
//             url: result.secure_url,
//             publicId: result.public_id
//         };
//     } catch (error) {
//         // Also try to delete temp file on error
//         if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
//         throw new Error(`Cloud upload failed: ${error.message}`);

//     }

//     /* OPTION B: AWS S3 (Uncomment this in the future to switch)
//     // const s3Result = await s3.upload({...}).promise();
//     // return { url: s3Result.Location, publicId: s3Result.Key };
//     */

//     // Add helper to delete from cloud (for withdrawal)
//     const deleteFromProvider = async (publicId) => {
//         if (!publicId) return;
//         try {
//             await cloudinary.uploader.destroy(publicId, { invalidate: true });
//         } catch (error) {
//             console.warn('Cloud delete failed:', error.message);
//         }
//     };

// };

// module.exports = { uploadToProvider, deleteFromProvider };



// services/storageService.js
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

/**
 * Uploads a file to Cloudinary
 * @param {Object} file - Multer file object
 * @returns {Object} { url, publicId }
 */

const uploadToProvider = async (file) => {
    try {
        const isVideo = file.mimetype.startsWith('video/');

        const uploadOptions = {
            folder: 'app_uploads',
            resource_type: isVideo ? 'video' : 'image',
            overwrite: false
        };

        const result = await cloudinary.uploader.upload(file.path, uploadOptions);

        const thumbnailUrl = isVideo
            ? cloudinary.url(result.public_id, {
                resource_type: 'video',
                format: 'jpg',
                transformation: [{ width: 400, crop: 'scale' }],
            })
            : null;

        // Clean up
        await fs.promises.unlink(file.path).catch(() => { });

        return {
            url: result.secure_url,      // full media URL
            publicId: result.public_id,
            thumbnailUrl: thumbnailUrl,  // only for videos
        };
    } catch (error) {
        await fs.promises.unlink(file.path).catch(() => { });
        throw new Error(`Upload failed: ${error.message}`);
    }
};

/**
 * Deletes a file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 */
const deleteFromProvider = async (publicId) => {
    if (!publicId) return;

    try {
        await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (error) {
        console.warn('Cloudinary delete failed:', error.message);
        // Don't crash the app — withdrawal should still succeed
    }
};

module.exports = { uploadToProvider, deleteFromProvider };