const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    contestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contest',
        required: true,
        index: true
    },
    orderId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    paymentId: {
        type: String,
        sparse: true,
        unique: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        required: true,
        uppercase: true
    },
    status: {
        type: String,
        enum: ['pending', 'verified', 'failed', 'refunded', 'suspicious'],
        default: 'pending',
        index: true
    },
    used: {
        type: Boolean,
        default: false
    },
    usedAt: {
        type: Date
    },
    verifiedAt: {
        type: Date
    },
    failedAt: {
        type: Date
    },
    refundedAt: {
        type: Date
    },
    refundId: {
        type: String
    },
    refundAmount: {
        type: Number
    },
    // Additional metadata
    metadata: {
        countryCode: String,
        fxRate: Number,
        originalINR: Number
    },
    razorpayData: {
        method: String,
        email: String,
        contact: String
    },
    suspiciousReason: String,
    webhookData: mongoose.Schema.Types.Mixed,
    error: String

}, { timestamps: true });

// Compound indexes for efficient queries
paymentSchema.index({ userId: 1, contestId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'verified' } });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ contestId: 1, status: 1 });

module.exports = mongoose.model('Payment', paymentSchema);