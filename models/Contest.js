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
    bannerImage: { type: String, default: null },
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

    highlightPhotos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FileMeta' }],

    contestStatus: {
        type: String,
        enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'],
        default: 'published',
        index: true
    },

    isPublic: { type: Boolean, default: true },
    maxSubmissionsPerUser: { type: Number, default: 1, min: 1 },
    allowedMediaTypes: {
        type: [String],
        enum: ['image', 'video'],
        default: ['image']
    },
    maxFileSize: {
        type: Number,
        default: 50 * 1024 * 1024,
        min: 1024,
        max: 500 * 1024 * 1024
    },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    entryFee: {
        type: Number,
        default: 0,
        min: 0
    },
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    rules: { type: mongoose.Schema.Types.ObjectId, ref: 'ContestRules' },
    settlement: {
        finalized: { type: Boolean, default: false },
        finalizedAt: Date,
        payoutStatus: {
            type: String,
            enum: ['pending', 'processing', 'paid', 'failed'],
            default: 'pending'
        },
        holdReason: { type: String }
    }

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

ContestSchema.virtual('isOpenForSubmissions').get(function () {
    const now = new Date();
    const isActive = ['published', 'ongoing'].includes(this.contestStatus);
    return isActive && this.startDate <= now && this.endDate >= now;
});

ContestSchema.virtual('parsedEntryFee').get(function () {
    if (this.entryFee > 0) return this.entryFee;
    if (!this.prizeText) return 0;
    const match = this.prizeText.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
});

ContestSchema.pre('save', function (next) {
    const shouldRecalculate =
        this.isNew ||
        this.isModified('startDate') ||
        this.isModified('endDate') ||
        this.isModified('contestStatus');

    if (!shouldRecalculate) return next();

    if (this.contestStatus !== 'draft' && this.contestStatus !== 'cancelled') {
        const now = new Date();
        if (now < this.startDate) {
            this.contestStatus = 'published';
        } else if (now >= this.startDate && now <= this.endDate) {
            this.contestStatus = 'ongoing';
        } else {
            this.contestStatus = 'completed';
        }
    }
    next();
});

ContestSchema.index({ participants: 1 });
ContestSchema.index({ payments: 1 });

module.exports = mongoose.model('Contest', ContestSchema);