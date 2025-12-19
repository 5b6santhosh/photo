const mongoose = require('mongoose');

const ContestSchema = new mongoose.Schema({
    title: String,
    description: String,
    bannerImage: String,
    isActive: Boolean,
    startDate: Date,
    endDate: Date,
    createdBy: String,
}, { timestamps: true });

module.exports = mongoose.model('Contest', ContestSchema);
