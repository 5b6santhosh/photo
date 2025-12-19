const mongoose = require('mongoose');

const SaveSchema = new mongoose.Schema(
    {
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Save', SaveSchema);
