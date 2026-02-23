const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const razorpay = require('../services/razorpay');
const ContestEntry = require('../models/ContestEntry');
const User = require('../models/User');
const Contest = require('../models/Contest');
const redis = require('../services/redis');

const router = express.Router();

const ALLOWED_EVENTS = new Set([
    'payment.captured',
    'payment.failed',
    'refund.processed'
]);

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(rawBody, signature, secret) {
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
    );
}

/**
 * Check if webhook was already processed (idempotency)
 */
async function isWebhookProcessed(webhookId) {
    try {
        const exists = await redis.exists(`webhook:${webhookId}`);
        return exists === 1;
    } catch (err) {
        console.error('Redis check error:', err);
        // If Redis fails, allow processing (fail-open strategy)
        return false;
    }
}

/**
 * Mark webhook as processed
 */
async function markWebhookProcessed(webhookId) {
    try {
        await redis.setex(`webhook:${webhookId}`, 86400, '1'); // 24h TTL
    } catch (err) {
        console.error('Redis set error:', err);
        // Non-blocking - webhook processing continues
    }
}

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(paymentEntity) {
    const paymentId = paymentEntity.id;
    const orderId = paymentEntity.order_id;

    // Find payment by EITHER paymentId OR orderId (for robustness)
    const payment = await Payment.findOne({
        $or: [
            { paymentId },
            { orderId }
        ]
    });

    if (!payment) {
        console.warn(`Payment ${paymentId} / Order ${orderId} not found in database`);
        return { success: false, reason: 'payment_not_found' };
    }

    // Idempotency check at payment level
    if (payment.status === 'verified') {
        console.log(`Payment ${paymentId} already verified`);
        return { success: true, reason: 'already_processed' };
    }

    // Fetch and validate order details
    let order;
    try {
        order = await razorpay.orders.fetch(paymentEntity.order_id);
    } catch (err) {
        console.error(`Failed to fetch order ${paymentEntity.order_id}:`, err);
        return { success: false, reason: 'order_fetch_failed' };
    }

    // Validate amount & currency
    const expectedAmount = parseInt(order.notes?.expectedAmount);
    const actualAmount = parseInt(paymentEntity.amount);

    if (!expectedAmount || !order.notes?.currency) {
        console.error(`Missing expectedAmount or currency in order notes for ${paymentEntity.order_id}`);
        return { success: false, reason: 'missing_order_notes' };
    }

    if (actualAmount !== expectedAmount || paymentEntity.currency !== order.notes.currency) {
        await Payment.findByIdAndUpdate(payment._id, {
            status: 'suspicious',
            suspiciousReason: 'amount_or_currency_mismatch',
            webhookData: {
                expected: { amount: expectedAmount, currency: order.notes.currency },
                received: { amount: actualAmount, currency: paymentEntity.currency }
            }
        });

        console.error(`Payment ${paymentId} failed validation - Amount/Currency mismatch`);
        return { success: false, reason: 'validation_failed' };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    // Update payment and create contest entry
    try {
        // Mark payment as verified and update paymentId if needed
        await Payment.findByIdAndUpdate(payment._id, {
            paymentId: paymentEntity.id, // Ensure paymentId is set
            status: 'verified',
            verifiedAt: new Date(),
            razorpayData: {
                method: paymentEntity.method,
                email: paymentEntity.email,
                contact: paymentEntity.contact
            }
        },
            { session }
        );

        // Create contest entry with upsert
        const contestEntryResult = await ContestEntry.updateOne(
            {
                contestId: payment.contestId,
                userId: payment.userId
            },
            {
                $setOnInsert: {
                    contestId: payment.contestId,
                    userId: payment.userId,
                    paymentId: payment._id,
                    status: 'paid',
                    createdAt: new Date()
                }
            },
            { upsert: true, session }
        );

        // Update User and Contest documents (add to arrays)
        await Promise.all([
            User.updateOne(
                { _id: payment.userId },
                {
                    $addToSet: {
                        payments: payment._id,
                        contestsJoined: payment.contestId
                    }
                },
                { session }

            ),
            Contest.updateOne(
                { _id: payment.contestId },
                {
                    $addToSet: {
                        payments: payment._id,
                        participants: payment.userId
                    }
                }, { session }
            )
        ]);
        await session.commitTransaction();

        if (contestEntryResult.upsertedCount > 0) {
            console.log(`✓ ContestEntry created for user ${payment.userId} in contest ${payment.contestId}`);
        } else {
            console.log(`ContestEntry already exists for user ${payment.userId} in contest ${payment.contestId}`);
        }

        return { success: true };

    } catch (err) {
        await session.abortTransaction();
        // Rollback payment status if contest entry fails
        if (err.code !== 11000) { // Not a duplicate key error
            try {
                await Payment.findByIdAndUpdate(payment._id, {
                    status: 'pending',
                    error: err.message
                });
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr);
            }
            throw err;
        }

        // Duplicate entry is acceptable (idempotency)
        console.log('ContestEntry duplicate - safe to ignore');
        return { success: true };
    } finally {
        await session.endSession();
    }

}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(paymentEntity) {
    const paymentId = paymentEntity.id;

    const result = await Payment.findOneAndUpdate(
        { paymentId, status: { $ne: 'failed' } },
        {
            status: 'failed',
            failedAt: new Date(),
            errorCode: paymentEntity.error_code,
            errorDescription: paymentEntity.error_description
        }
    );

    if (result) {
        console.log(`✓ Payment ${paymentId} marked as failed`);
    } else {
        console.log(`Payment ${paymentId} already failed or not found`);
    }

    return { success: true };
}

/**
 * Handle refund.processed event
 */
async function handleRefundProcessed(refundEntity) {
    const paymentId = refundEntity.payment_id;
    const refundId = refundEntity.id;

    const payment = await Payment.findOne({ paymentId });
    if (!payment) {
        console.warn(`Payment ${paymentId} not found for refund ${refundId}`);
        return { success: false, reason: 'payment_not_found' };
    }

    // Prevent double refund processing
    if (payment.status === 'refunded') {
        console.log(`Payment ${paymentId} already refunded`);
        return { success: true, reason: 'already_refunded' };
    }

    // Update payment
    await Payment.findByIdAndUpdate(payment._id, {
        status: 'refunded',
        used: false,
        refundedAt: new Date(),
        refundId: refundId,
        refundAmount: refundEntity.amount
    });

    // Update contest entry
    const contestEntry = await ContestEntry.findOneAndUpdate(
        { paymentId: payment._id },
        {
            status: 'refunded',
            refundedAt: new Date()
        }
    );

    if (contestEntry) {
        console.log(`✓ ContestEntry refunded for payment ${paymentId}`);
    } else {
        console.warn(`No ContestEntry found for payment ${paymentId}`);
    }

    return { success: true };
}

/**
 * Main webhook handler
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();

    // Verify webhook secret is configured
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error(' RAZORPAY_WEBHOOK_SECRET is not configured');
        return res.status(500).json({
            status: 'error',
            message: 'Server misconfigured'
        });
    }

    // Get signature and raw body
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
        console.error(' Missing x-razorpay-signature header');
        return res.status(400).json({
            status: 'error',
            message: 'Missing signature'
        });
    }

    // Get raw body (ensure you're using express.raw() middleware for this route)
    let rawBody;
    if (Buffer.isBuffer(req.body)) {
        rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
        rawBody = req.body;
    } else {
        rawBody = JSON.stringify(req.body);
    }

    // Verify signature
    try {
        if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
            console.error(' Webhook signature verification failed');
            return res.status(400).json({
                status: 'error',
                message: 'Invalid signature'
            });
        }
    } catch (err) {
        console.error(' Signature verification error:', err);
        return res.status(400).json({
            status: 'error',
            message: 'Signature verification failed'
        });
    }

    // Parse event
    let event;
    try {
        event = JSON.parse(rawBody);
    } catch (err) {
        console.error(' Invalid JSON in webhook payload');
        return res.status(400).json({
            status: 'error',
            message: 'Invalid JSON'
        });
    }

    // Validate event structure
    if (!event.event || !event.payload) {
        console.error(' Invalid event structure');
        return res.status(400).json({
            status: 'error',
            message: 'Invalid event structure'
        });
    }

    // Check for webhook ID (for idempotency)
    const webhookId = event.payload?.payment?.entity?.id ||
        event.payload?.refund?.entity?.id ||
        event.created_at + '_' + event.event;

    // FIXED: Added await
    if (await isWebhookProcessed(webhookId)) {
        console.log(`  Duplicate webhook detected: ${webhookId}`);
        return res.status(200).json({
            status: 'ok',
            message: 'Already processed'
        });
    }

    // Filter allowed events
    if (!ALLOWED_EVENTS.has(event.event)) {
        console.log(` Ignored event: ${event.event}`);
        return res.status(200).json({
            status: 'ignored',
            event: event.event
        });
    }

    // Process event
    try {
        let result;

        switch (event.event) {
            case 'payment.captured':
                result = await handlePaymentCaptured(event.payload.payment.entity);
                break;

            case 'payment.failed':
                result = await handlePaymentFailed(event.payload.payment.entity);
                break;

            case 'refund.processed':
                result = await handleRefundProcessed(event.payload.refund.entity);
                break;

            default:
                console.warn(`Unhandled event type: ${event.event}`);
                return res.status(200).json({
                    status: 'ignored',
                    message: 'Event type not handled'
                });
        }

        // FIXED: Added await
        await markWebhookProcessed(webhookId);

        const duration = Date.now() - startTime;
        console.log(`✓ Webhook processed successfully in ${duration}ms - Event: ${event.event}`);

        return res.status(200).json({
            status: 'ok',
            event: event.event,
            result: result,
            duration: `${duration}ms`
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(` Webhook processing error (${duration}ms):`, {
            event: event.event,
            error: err.message,
            stack: err.stack
        });

        return res.status(500).json({
            status: 'error',
            message: 'Processing failed',
            event: event.event
        });
    }
});

module.exports = router;