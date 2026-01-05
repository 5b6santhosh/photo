const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema(
    {
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FileMeta',
            required: true,
            index: true,
        },
        reportedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['pending', 'reviewed', 'removed'],
            default: 'pending',
        },
    },
    { timestamps: true }
);

//  Prevent duplicate reports
ReportSchema.index({ fileId: 1, reportedBy: 1 }, { unique: true });

module.exports = mongoose.model('Report', ReportSchema);
