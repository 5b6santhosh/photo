const LikeSchema = new mongoose.Schema(
    {
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta', required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

LikeSchema.index({ fileId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Like', LikeSchema);
