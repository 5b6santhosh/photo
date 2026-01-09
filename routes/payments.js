const express = require('express');
const mongoose = require('mongoose');
const razorpay = require('../services/razorpay');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Contest = require('../models/Contest');
const { getFxRate } = require('../services/fxService');
const { getRegion } = require('../config/currencyMap');
const User = require('../models/User');

const router = express.Router();

/**
 * POST /api/payments/create-order
 */
router.post('/create-order', auth, async (req, res) => {
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
            } catch {
                return res.status(503).json({ message: 'Currency conversion unavailable' });
            }
            finalAmount = Math.ceil(baseInINR * fxRate * multiplier * 100);
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
                countryCode
            }
        });

        res.json({
            orderId: order.id,
            amount: finalAmount,
            currency,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to create order' });
    }
});


// POST /api/payments/verify
router.post('/verify', auth, async (req, res) => {
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        contestId
    } = req.body;

    const userId = req.user.id;

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ verified: false });
    }

    try {
        if (!mongoose.Types.ObjectId.isValid(contestId)) {
            return res.status(400).json({ message: 'Invalid contest ID' });
        }

        const order = await razorpay.orders.fetch(razorpay_order_id);

        if (order.notes.contestId !== contestId || order.notes?.userId !== userId
        ) {
            return res.status(400).json({ verified: false, message: 'Order mismatch' });
        }

        const contest = await Contest.findById(contestId);
        if (!contest || contest.entryFee <= 0) {
            return res.status(400).json({ verified: false });
        }

        const existingEntry = await Payment.findOne({
            userId: req.user.id,
            contestId,
            status: 'verified'
        });
        if (existingEntry) {
            return res.status(400).json({ message: 'You already paid for this contest' });
        }

        const expectedAmount = order.notes?.expectedAmount;
        const expectedCurrency = order.notes?.currency;

        if (
            order.amount !== expectedAmount ||
            order.currency !== expectedCurrency
        ) {
            return res.status(400).json({ verified: false, message: 'Order amount mismatch' });
        }

        const payment = await Payment.create({
            userId,
            contestId,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            amount: order.amount,
            currency: order.currency,
            status: 'verified',
            used: false
        });

        await Promise.all([
            User.updateOne(
                { _id: userId },
                {
                    $addToSet: {
                        payments: payment._id,
                        contestsJoined: contestId
                    }
                }
            ),
            Contest.updateOne(
                { _id: contestId },
                {
                    $addToSet: {
                        payments: payment._id,
                        participants: userId
                    }
                }
            )
        ]);

        res.json({ verified: true, paymentId: payment.paymentId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ verified: false });
    }
});


module.exports = router;
