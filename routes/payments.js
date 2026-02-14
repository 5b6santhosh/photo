const express = require('express');
const mongoose = require('mongoose');
const razorpay = require('../services/razorpay');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Contest = require('../models/Contest');
const { getFxRate } = require('../services/fxService');
const { getRegion } = require('../config/currencyMap');
const User = require('../models/User');
const ContestEntry = require('../models/ContestEntry');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/payments/create-order
 */
router.post('/create-order', authMiddleware, async (req, res) => {
    try {
        const { contestId, countryCode } = req.body;

        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contest = await Contest.findById(contestId);
        if (!contest) {
            return res.status(404).json({ message: 'Event not found' });
        }
        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({ message: 'Contest is not open' });
        }
        if (contest.entryFee <= 0) {
            return res.status(400).json({ message: 'This contest is free' });
        }

        const existingPayment = await Payment.findOne({
            userId: req.user.id,
            contestId,
            status: { $in: ['pending', 'verified'] }
        });

        if (existingPayment) {
            return res.status(400).json({
                message: existingPayment.status === 'verified'
                    ? 'You have already paid for this contest'
                    : 'You already have a pending payment for this contest. Please wait.',
                existingPaymentId: existingPayment.paymentId,
                status: existingPayment.status
            });
        }
        const ZERO_DECIMAL_CURRENCIES = new Set([
            'BIF', // Burundian Franc
            'CLP', // Chilean Peso  
            'DJF', // Djiboutian Franc
            'GNF', // Guinean Franc
            'JPY', // Japanese Yen
            'KMF', // Comorian Franc
            'KRW', // South Korean Won
            'MGA', // Malagasy Ariary
            'PYG', // Paraguayan Guarani
            'RWF', // Rwandan Franc
            'UGX', // Ugandan Shilling
            'VND', // Vietnamese Dong
            'VUV', // Vanuatu Vatu
            'XAF', // Central African CFA Franc
            'XOF', // West African CFA Franc
            'XPF'  // CFP Franc
        ]);

        const region = getRegion(countryCode);
        const { currency, multiplier } = region;

        const baseInINR = contest.entryFee;
        let finalAmount;
        let fxRate;

        if (currency === 'INR') {
            finalAmount = baseInINR * 100;
        } else {
            try {
                fxRate = await getFxRate(currency);
                if (!fxRate || fxRate <= 0) {
                    throw new Error('Invalid FX rate');
                }
            } catch (err) {
                console.error('FX rate fetch error:', err);
                return res.status(503).json({
                    message: 'Currency conversion service unavailable. Please try again.'
                });
            }

            // finalAmount = Math.ceil(baseInINR * fxRate * multiplier * 100);
            // Convert INR to target currency
            const amountInTargetCurrency = baseInINR * fxRate * multiplier;
            if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
                finalAmount = Math.ceil(amountInTargetCurrency);
            } else {
                finalAmount = Math.ceil(amountInTargetCurrency * 100);
            }

        }

        if (finalAmount <= 0 || finalAmount > 1000000000) { // 10 crore paise max
            return res.status(400).json({ message: 'Invalid payment amount calculated' });
        }


        const order = await razorpay.orders.create({
            amount: finalAmount,
            currency,
            receipt: `contest_${contestId}_${Date.now()}`,
            notes: {
                contestId: contestId.toString(),
                userId: req.user.id,
                originalINR: baseInINR,
                expectedAmount: finalAmount,
                currency,
                countryCode,
                fxRate: fxRate || 1,
                createdAt: new Date().toISOString()

            }
        });

        await Payment.create({
            userId: req.user.id,
            contestId,
            orderId: order.id,
            amount: finalAmount,
            currency,
            status: 'pending',
            used: false,
            metadata: {
                countryCode,
                fxRate: fxRate || 1,
                originalINR: baseInINR
            }
        });


        res.json({
            orderId: order.id,
            amount: finalAmount,
            currency,
            key: process.env.RAZORPAY_KEY_ID,
            contestId: contestId.toString()
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to create order' });
    }
});


// POST /api/payments/verify
router.post('/verify', authMiddleware, async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        contestId
    } = req.body;

    const userId = req.user.id;

    // ─────────────────────────────────────────────
    // 1. Input Validation
    // ─────────────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !contestId) {
        return res.status(400).json({
            verified: false,
            message: 'Missing required payment parameters'
        });
    }

    if (!mongoose.Types.ObjectId.isValid(contestId)) {
        return res.status(400).json({
            verified: false,
            message: 'Invalid contest ID'
        });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

    const isValidSignature = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(razorpay_signature)
    );

    if (!isValidSignature) {
        console.warn(`Invalid signature for payment ${razorpay_payment_id}`);
        return res.status(400).json({
            verified: false,
            message: 'Payment signature verification failed'
        });
    }

    try {
        const order = await razorpay.orders.fetch(razorpay_order_id);

        if (order.notes?.contestId !== contestId.toString()) {
            console.warn(`Contest mismatch: expected ${contestId}, got ${order.notes?.contestId}`);
            return res.status(400).json({
                verified: false,
                message: 'Order does not match contest'
            });
        }

        if (order.notes?.userId !== userId.toString()) {
            console.warn(`User mismatch: expected ${userId}, got ${order.notes?.userId}`);
            return res.status(400).json({
                verified: false,
                message: 'Order does not belong to this user'
            });
        }

        const contest = await Contest.findById(contestId);
        if (!contest || contest.entryFee <= 0) {
            return res.status(400).json({ verified: false });
        }

        // ─────────────────────────────────────────────
        // 4. Update Payment Record with paymentId
        // ─────────────────────────────────────────────
        // Note: We do NOT set status to 'verified' here
        // The webhook will handle actual verification and contest entry creation

        const payment = await Payment.findOneAndUpdate(
            {
                orderId: razorpay_order_id,
                userId,
                contestId
            },
            {
                $set: {
                    paymentId: razorpay_payment_id,
                    // Status remains 'pending' until webhook confirms
                    updatedAt: new Date()
                }
            },
            { new: true }
        );

        if (!payment) {
            console.warn(`Payment record not found for order ${razorpay_order_id}`);
            return res.status(404).json({
                verified: false,
                message: 'Payment record not found'
            });
        }

        // ─────────────────────────────────────────────
        // 5. Return Success Response
        // ─────────────────────────────────────────────
        // Frontend can now show "processing" state
        // Webhook will complete the verification and create contest entry

        res.json({
            verified: true,
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            message: 'Payment received. Verification in progress...',
            status: 'processing'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ verified: false });
    }
});

/**
 * GET /api/payments/status/:paymentId
 * Check payment verification status (for polling after payment)
 */
router.get('/status/:paymentId', authMiddleware, async (req, res) => {
    try {
        const { paymentId } = req.params;

        const payment = await Payment.findOne({
            paymentId,
            userId: req.user.id
        }).select('status contestId paymentId amount currency verifiedAt');

        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        // Check if contest entry exists
        let contestEntry = null;
        if (payment.status === 'verified') {
            contestEntry = await ContestEntry.findOne({
                paymentId: payment._id,
                userId: req.user.id
            }).select('status createdAt');
        }

        res.json({
            status: payment.status,
            contestId: payment.contestId,
            paymentId: payment.paymentId,
            amount: payment.amount,
            currency: payment.currency,
            verifiedAt: payment.verifiedAt,
            contestEntry: contestEntry ? {
                status: contestEntry.status,
                createdAt: contestEntry.createdAt
            } : null
        });

    } catch (err) {
        console.error('Payment status check error:', err);
        res.status(500).json({ message: 'Failed to check payment status' });
    }
});


/**
 * GET /api/payments/my-payments
 * Get user's payment history
 */
router.get('/my-payments', authMiddleware, async (req, res) => {
    try {
        const payments = await Payment.find({ userId: req.user.id })
            .populate('contestId', 'title entryFee')
            .sort({ createdAt: -1 })
            .limit(50)
            .select('-__v');

        res.json({ payments });

    } catch (err) {
        console.error('Fetch payments error:', err);
        res.status(500).json({ message: 'Failed to fetch payment history' });
    }
});

/**
 * GET /api/payments/status-by-contest/:contestId
 * Get payment status for a user in a specific contest
 */
router.get('/status-by-contest/:contestId', authMiddleware, async (req, res) => {
    try {
        const { contestId } = req.params;
        const userId = req.user.id;

        const payment = await Payment.findOne({
            contestId,
            userId
        }).select('status contestId paymentId amount currency verifiedAt');

        if (!payment) {
            return res.status(404).json({ message: 'No payment found for this contest' });
        }

        let contestEntry = null;
        if (payment.status === 'verified') {
            contestEntry = await ContestEntry.findOne({
                paymentId: payment._id,
                userId
            }).select('status createdAt');
        }

        res.json({
            status: payment.status,
            contestId: payment.contestId,
            paymentId: payment.paymentId,
            amount: payment.amount,
            currency: payment.currency,
            verifiedAt: payment.verifiedAt,
            contestEntry: contestEntry
                ? {
                    status: contestEntry.status,
                    createdAt: contestEntry.createdAt
                }
                : null
        });
    } catch (err) {
        console.error('Payment status by contest error:', err);
        res.status(500).json({ message: 'Failed to fetch payment status' });
    }
});

module.exports = router;
