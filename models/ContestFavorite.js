const mongoose = require('mongoose');

const ContestFavoriteSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        contestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', required: true },
    },
    { timestamps: true }
);

ContestFavoriteSchema.index({ userId: 1, contestId: 1 }, { unique: true });

module.exports = mongoose.model('ContestFavorite', ContestFavoriteSchema);