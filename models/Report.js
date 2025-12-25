const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema(
    {
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' },
        reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        status: {
            type: String,
            enum: ['pending', 'reviewed', 'removed'],
            default: 'pending',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Report', ReportSchema);
