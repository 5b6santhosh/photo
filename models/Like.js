const mongoose = require('mongoose');

const LikeSchema = new mongoose.Schema(
    {
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Like', LikeSchema);
