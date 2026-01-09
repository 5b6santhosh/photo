// const express = require('express');
// const crypto = require('crypto');
// const Payment = require('../models/Payment');
// const razorpay = require('../services/razorpay');
// const mongoose = require('mongoose');
// const router = express.Router();

// router.post('/', async (req, res) => {
//     const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

//     if (!webhookSecret) {
//         console.error('RAZORPAY_WEBHOOK_SECRET is not set');
//         return res.status(500).send('Server misconfigured');
//     }

//     const signature = req.headers['x-razorpay-signature'];
//     const body = req.body.toString(); // RAW BODY REQUIRED

//     const expectedSignature = crypto
//         .createHmac('sha256', webhookSecret)
//         .update(body)
//         .digest('hex');

//     if (expectedSignature !== signature) {
//         console.error('Webhook signature mismatch');
//         return res.status(400).send('Invalid signature');
//     }

//     let event;
//     try {
//         event = JSON.parse(body);
//     } catch (e) {
//         console.error('Failed to parse webhook body:', e.message);
//         return res.status(400).send('Invalid payload');
//     }

//     const payload = event.payload;

//     try {
//         console.log(`Processing Razorpay webhook event: ${event.event}`);

//         switch (event.event) {
//             case 'payment.captured': {
//                 const paymentEntity = payload.payment.entity;
//                 const orderId = paymentEntity.order_id;
//                 const paymentId = paymentEntity.id;

//                 let order;
//                 try {
//                     order = await razorpay.orders.fetch(orderId);
//                 } catch (err) {
//                     console.error(`Failed to fetch order ${orderId}:`, err.message);
//                     return res.status(400).json({ status: 'error', reason: 'order_fetch_failed' });
//                 }

//                 const contestId = order.notes?.contestId;
//                 const userId = order.notes?.userId;

//                 if (!contestId || !userId) {
//                     console.error('Order notes missing contestId or userId:', orderId);
//                     return res.status(400).json({ status: 'error', reason: 'missing_metadata' });
//                 }

//                 if (!mongoose.Types.ObjectId.isValid(contestId)) {
//                     console.error('Invalid contestId in order notes:', contestId);
//                     return res.status(400).json({ status: 'error', reason: 'invalid_contest_id' });
//                 }

//                 await Payment.findOneAndUpdate(
//                     { paymentId },
//                     {
//                         userId,
//                         contestId,
//                         orderId,
//                         amount: paymentEntity.amount,
//                         currency: paymentEntity.currency,
//                         status: 'verified',
//                         used: false
//                     },
//                     {
//                         // upsert: true,
//                         new: true
//                     }
//                 );

//                 console.log(`Payment ${paymentId} verified for contest ${contestId}`);
//                 break;
//             }


//             case 'payment.failed': {
//                 const paymentId = payload.payment.entity.id;
//                 await Payment.findOneAndUpdate(
//                     { paymentId },
//                     { status: 'failed' },
//                     { upsert: false }
//                 );
//                 console.log(`Payment ${paymentId} failed`);
//                 break;
//             }

//             case 'refund.processed': {
//                 const paymentId = payload.refund.entity.payment_id;
//                 await Payment.findOneAndUpdate(
//                     { paymentId },
//                     {
//                         status: 'refunded',
//                         used: false // or true, depending on your business logic
//                     },
//                     { upsert: false }
//                 );
//                 console.log(`Payment ${paymentId} refunded`);
//                 break;
//             }


//             default:
//                 console.log(`Unhandled Razorpay event: ${event.event}`);
//         }

//         return res.status(200).json({ status: 'ok' });

//     } catch (err) {
//         console.error('Webhook error:', err);
//         res.status(500).json({ status: 'error' });
//     }
// });

// module.exports = router;


const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const razorpay = require('../services/razorpay');

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

            // ─────────────────────────────────────────────
            case 'payment.captured': {
                const paymentEntity = event.payload.payment.entity;
                const paymentId = paymentEntity.id;

                //  Idempotency check
                const existingPayment = await Payment.findOne({ paymentId });
                if (!existingPayment) {
                    console.warn(`Payment ${paymentId} not found. Ignoring.`);
                    break;
                }

                if (existingPayment.status === 'verified') {
                    console.log(`Payment ${paymentId} already verified. Skipping.`);
                    break;
                }

                // Fetch order for verification
                const order = await razorpay.orders.fetch(paymentEntity.order_id);

                const expectedAmount = order.notes?.expectedAmount;
                const expectedCurrency = order.notes?.currency;

                if (
                    paymentEntity.amount !== expectedAmount ||
                    paymentEntity.currency !== expectedCurrency
                ) {
                    await Payment.findByIdAndUpdate(existingPayment._id, {
                        status: 'suspicious'
                    });
                    console.error(`Amount mismatch for payment ${paymentId}`);
                    break;
                }

                await Payment.findByIdAndUpdate(existingPayment._id, {
                    status: 'verified'
                });

                console.log(`Payment ${paymentId} verified`);
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

                await Payment.findOneAndUpdate(
                    { paymentId },
                    {
                        status: 'refunded',
                        used: false
                    }
                );

                console.log(`Payment ${paymentId} refunded`);
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
