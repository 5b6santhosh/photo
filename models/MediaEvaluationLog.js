const mongoose = require('mongoose');

const MediaEvaluationLogSchema = new mongoose.Schema({
    contestId: mongoose.Schema.Types.ObjectId,

    mediaType: String,

    media_features: Object,
    visual_stats: Object,
    aesthetic_features: Object,
    semantic_features: Object,
    contest_context: Object,

    labels: Object,

    createdAt: { type: Date, default: Date.now }

}, { strict: false });

module.exports = mongoose.model(
    'MediaEvaluationLog',
    MediaEvaluationLogSchema
);
