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
    let contestId;
    let userId;
    try {
        const { contestId: bodyContestId, countryCode } = req.body;
        contestId = bodyContestId;
        userId = req.user.id;

        if (!contestId || !mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const contest = await Contest.findById(contestId);
        if (!contest) {
            return res.status(404).json({ message: 'Event not found' });
        }

        if (!contest.isOpenForSubmissions) {
            return res.status(400).json({ message: 'Contest is not open' });
        }

        // Get base amount in INR (the actual entry fee, e.g., 500)
        let baseInINR = contest.entryFee || 0;
        if (baseInINR <= 0 && contest.prizeText && !contest.entryFee) {
            const match = contest.prizeText.match(/\d+/);
            if (match) {
                baseInINR = parseInt(match[0], 10);
            }
        }

        if (!baseInINR || baseInINR <= 0) {
            console.log('Contest entry fee:', contest.entryFee);
            console.log('Contest prizeText:', contest.prizeText);
            return res.status(400).json({
                message: 'This contest is free or has no entry fee set',
                entryFee: contest.entryFee,
                prizeText: contest.prizeText
            });
        }

        const existingPayment = await Payment.findOne({
            userId,
            contestId,
            status: { $in: ['pending', 'verified'] }
        });
        if (existingPayment) {

            if (existingPayment.status === 'verified') {
                return res.status(400).json({
                    message: existingPayment.status === 'verified'
                        ? 'You have already paid for this contest'
                        : 'You already have a pending payment for this contest. Please wait.',
                    existingPaymentId: existingPayment.paymentId,
                    status: existingPayment.status
                });
            }

            const ageMinutes = (Date.now() - existingPayment.createdAt) / 60000;
            if (ageMinutes > 15) {
                await Payment.findByIdAndUpdate(existingPayment._id, {
                    $set: { status: 'cancelled', updatedAt: new Date() }
                });
            } else {
                return res.status(400).json({
                    message: 'You already have a pending payment. Please wait or retry.',
                    existingPaymentId: existingPayment.paymentId,
                    status: existingPayment.status
                });
            }

        }

        // Currencies that don't use decimal places (smallest unit = major unit)
        const ZERO_DECIMAL_CURRENCIES = new Set([
            'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
            'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
        ]);

        const region = getRegion(countryCode);
        const { currency, multiplier } = region;

        let finalAmount;
        let fxRate = 1;
        let amountInTargetCurrency;

        if (currency === 'INR') {
            // For INR: baseInINR is the major unit (e.g., 500 rupees)
            // Razorpay expects smallest unit (paise), so multiply by 100
            amountInTargetCurrency = baseInINR;
            finalAmount = baseInINR * 100; // Convert to paise
        } else {
            // Get exchange rate for target currency
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

            // Convert INR to target currency (major units)
            // Example: 500 INR * 0.012 (USD rate) * 1 (multiplier) = 6 USD
            amountInTargetCurrency = baseInINR * fxRate * multiplier;

            // Convert to smallest unit based on currency type
            if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
                // For zero-decimal currencies (e.g., JPY), amount is already in smallest unit
                finalAmount = Math.ceil(amountInTargetCurrency);
            } else {
                // For decimal currencies (e.g., USD, EUR), multiply by 100 to get cents
                finalAmount = Math.ceil(amountInTargetCurrency * 100);
            }
        }

        // Validation
        if (finalAmount <= 0 || finalAmount > 1000000000) {
            return res.status(400).json({
                message: 'Invalid payment amount calculated',
                details: {
                    baseInINR,
                    currency,
                    fxRate,
                    amountInTargetCurrency,
                    finalAmount
                }
            });
        }

        const receipt = `CTX_${contestId.slice(-8)}_${Date.now()}`;
        console.log('Receipt:', receipt, 'Length:', receipt.length);
        console.log('Payment calculation:', {
            baseInINR,
            currency,
            fxRate,
            multiplier,
            amountInTargetCurrency,
            finalAmount
        });

        try {
            const order = await razorpay.orders.create({
                amount: finalAmount,
                currency,
                receipt: receipt,
                notes: {
                    contestId: contestId.toString(),
                    userId: userId,
                    originalINR: baseInINR,
                    expectedAmount: finalAmount,
                    currency,
                    countryCode,
                    fxRate: fxRate,
                    createdAt: new Date().toISOString()
                }
            });

            console.log('Razorpay order created:', order.id);
            // const generatePaymentId = () => `PAY_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

            const payment = await Payment.create({
                userId,
                contestId,
                orderId: order.id,
                paymentId: order.id,
                amount: finalAmount,
                currency,
                status: 'pending',
                used: false,
                metadata: {
                    countryCode,
                    fxRate: fxRate,
                    originalINR: baseInINR,
                    amountInTargetCurrency: Math.round(amountInTargetCurrency * 100) / 100 // Store rounded value
                }
            });

            console.log('Payment record created:', payment._id);

            res.json({
                orderId: order.id,
                paymentId: payment.paymentId,
                amount: finalAmount,
                currency,
                key: process.env.RAZORPAY_KEY_ID,
                contestId: contestId.toString()
            });

        } catch (orderErr) {
            console.error('Order creation failed:', orderErr);
            console.error('Razorpay error details:', orderErr.error);
            throw orderErr;
        }

    } catch (err) {
        console.error('CREATE ORDER ERROR:', err);
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        console.error('Contest ID:', contestId);
        console.error('User ID:', userId);
        console.error('Error type:', err.constructor.name);
        console.error('Razorpay error:', err.error);

        res.status(500).json({
            message: 'Failed to create order',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
            razorpayError: process.env.NODE_ENV === 'development' ? err.error : undefined,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
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
        if (!contest || contest.prizeText <= 0) {
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
                    status: 'verified',   //--> work for now
                    verifiedAt: new Date(),   //--> work for now
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
            // message: 'Payment received. Verification in progress...',
            // status: 'processing'
            message: 'Payment verified successfully',
            status: 'verified'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ verified: false });
    }
});

router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.body;
        const userId = req.user.id;

        const updatedPayment = await Payment.findOneAndUpdate(
            { orderId, userId, status: 'pending' },
            { $set: { status: 'cancelled', updatedAt: new Date() } },
            { new: true }
        );

        if (!updatedPayment) {
            return res.status(404).json({
                success: false,
                message: "Order not found or already processed."
            });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
