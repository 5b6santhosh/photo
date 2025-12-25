// const mongoose = require('mongoose');

// const ContestSchema = new mongoose.Schema({
//     title: String,
//     description: String,
//     bannerImage: String,
//     isActive: Boolean,
//     startDate: Date,
//     endDate: Date,
//     createdBy: String,
// }, { timestamps: true });

// module.exports = mongoose.model('Contest', ContestSchema);

const mongoose = require('mongoose');

const ContestSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Contest title is required'],
        trim: true,
        maxlength: 120,
        index: true
    },
    subtitle: { type: String, default: '', trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },
    bannerImage: { type: String, default: '' },
    prizeText: { type: String, default: 'No prize information provided' },

    startDate: {
        type: Date,
        required: [true, 'Start date is required'],
        index: true
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required'],
        index: true,
        validate: {
            validator: function (v) {
                return !this.startDate || v > this.startDate;
            },
            message: 'End date must be after start date'
        }
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required'],
        index: true
    },

    submissions: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta', required: true },
        submittedAt: { type: Date, default: Date.now },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'shortlisted'],
            default: 'pending'
        }
    }],

    highlightPhotos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' }],
    submissionCount: { type: Number, default: 0 },
    contestStatus: {
        type: String,
        enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'],
        default: 'draft',
        index: true
    },

    isPublic: { type: Boolean, default: true },
    maxSubmissionsPerUser: { type: Number, default: 3, min: 1 }

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// --- VIRTUALS ---
ContestSchema.virtual('isActiveNow').get(function () {
    const now = new Date();
    return this.startDate <= now && this.endDate >= now;
});

// --- MIDDLEWARE ---
ContestSchema.pre('save', function (next) {
    if (this.isModified('submissions')) {
        this.submissionCount = this.submissions.length;
    }
    next();
});

module.exports = mongoose.model('Contest', ContestSchema);