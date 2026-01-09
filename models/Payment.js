// models/Payment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    contestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', required: true },
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String, required: true, unique: true }, // FIXED: Unique payment ID
    amount: { type: Number, required: true }, // in paise
    currency: { type: String, required: true },
    fxVersion: { type: String }, // optional for audits
    status: {
        type: String,
        enum: ['pending', 'verified', 'failed', 'refunded', 'suspicious'],
        default: 'pending'
    },
    used: { type: Boolean, default: false }, //  Critical for idempotency
    usedAt: Date

}, { timestamps: true });
// FIXED: Better indexing strategy
paymentSchema.index({ orderId: 1 }); // Helps webhook & debugging
paymentSchema.index({ userId: 1, contestId: 1 }); // Find user's payments for contest
paymentSchema.index({ paymentId: 1 }, { unique: true }); // Prevent duplicate payment IDs
paymentSchema.index({ userId: 1, contestId: 1, used: 1 }); // Query optimization
module.exports = mongoose.model('Payment', paymentSchema);