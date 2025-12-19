// User submits photo / reel to a contest

const mongoose = require('mongoose');

const ContestEntrySchema = new mongoose.Schema(
    {
        contestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Contest',
            required: true,
        },
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
        status: {
            type: String,
            enum: ['submitted', 'shortlisted', 'winner'],
            default: 'submitted',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ContestEntry', ContestEntrySchema);
