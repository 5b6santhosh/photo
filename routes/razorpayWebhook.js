const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const razorpay = require('../services/razorpay');
const ContestEntry = require('../models/ContestEntry');

const router = express.Router();

const ALLOWED_EVENTS = new Set([
    'payment.captured',
    'payment.failed',
    'refund.processed'
]);

router.post('/', async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('RAZORPAY_WEBHOOK_SECRET missing');
        return res.status(500).send('Server misconfigured');
    }

    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body.toString();

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    if (expectedSignature !== signature) {
        console.error('Webhook signature mismatch');
        return res.status(400).send('Invalid signature');
    }

    let event;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return res.status(400).send('Invalid JSON');
    }

    if (!ALLOWED_EVENTS.has(event.event)) {
        console.log(`Ignored event: ${event.event}`);
        return res.status(200).json({ status: 'ignored' });
    }

    try {
        switch (event.event) {

            case 'payment.captured': {
                const paymentEntity = event.payload.payment.entity;
                const paymentId = paymentEntity.id;

                const payment = await Payment.findOne({ paymentId });
                if (!payment) {
                    console.warn(`Payment ${paymentId} not found`);
                    break;
                }

                if (payment.status === 'verified') {
                    console.log(`Payment ${paymentId} already processed`);
                    break;
                }

                const order = await razorpay.orders.fetch(paymentEntity.order_id);

                // Validate amount & currency
                if (
                    paymentEntity.amount !== order.notes?.expectedAmount ||
                    paymentEntity.currency !== order.notes?.currency
                ) {
                    await Payment.findByIdAndUpdate(payment._id, {
                        status: 'suspicious'
                    });
                    console.error(`Payment ${paymentId} failed validation`);
                    break;
                }

                // Mark payment verified
                payment.status = 'verified';
                await payment.save();

                //  AUTO-CONTEST ENTRY
                try {
                    await ContestEntry.updateOne(
                        {
                            contestId: payment.contestId,
                            userId: payment.userId
                        },
                        {
                            $setOnInsert: {
                                contestId: payment.contestId,
                                userId: payment.userId,
                                paymentId: payment._id,
                                status: 'paid'
                            }
                        },
                        {
                            upsert: true
                        }
                    );
                } catch (err) {
                    if (err.code === 11000) {
                        console.log('ContestEntry already exists — safe to ignore');
                    } else {
                        throw err;
                    }
                }
                console.log(
                    `ContestEntry created for user ${payment.userId} in contest ${payment.contestId}`
                );
                break;
            }

            // ─────────────────────────────────────────────
            case 'payment.failed': {
                const paymentId = event.payload.payment.entity.id;

                await Payment.findOneAndUpdate(
                    { paymentId },
                    { status: 'failed' }
                );

                console.log(`Payment ${paymentId} marked failed`);
                break;
            }

            // ─────────────────────────────────────────────
            case 'refund.processed': {
                const paymentId = event.payload.refund.entity.payment_id;

                const payment = await Payment.findOne({ paymentId });
                if (!payment) break;

                await Payment.findByIdAndUpdate(payment._id, {
                    status: 'refunded',
                    used: false
                });

                await ContestEntry.findOneAndUpdate(
                    { paymentId: payment._id },
                    { status: 'refunded' }
                );

                console.log(`ContestEntry refunded for payment ${paymentId}`);
                break;
            }

        }

        return res.status(200).json({ status: 'ok' });

    } catch (err) {
        console.error('Webhook processing error:', err);
        return res.status(500).json({ status: 'error' });
    }
});

module.exports = router;
