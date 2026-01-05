// models/Share.js
const mongoose = require('mongoose');

const ShareSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FileMeta',
        required: true
    }
}, { timestamps: true });

ShareSchema.index({ userId: 1, fileId: 1 }, { unique: true });
module.exports = mongoose.model('Share', ShareSchema);