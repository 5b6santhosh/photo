const mongoose = require('mongoose');

const FavoriteSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FileMeta',
            required: true,
        },
    },
    { timestamps: true }
);

FavoriteSchema.index({ userId: 1, fileId: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', FavoriteSchema);
