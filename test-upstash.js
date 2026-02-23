require('dotenv').config();
const { Redis } = require('@upstash/redis');

async function testUpstash() {
    console.log('Testing Upstash Redis connection...\n');

    // Check if environment variables are set
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error(' Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
        console.log('Please add them to your .env file');
        process.exit(1);
    }

    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    try {
        // Test 1: Basic SET and GET
        console.log('Test 1: Basic SET and GET');
        await redis.set('test_key', 'Hello Upstash!');
        const value = await redis.get('test_key');
        console.log(' Value retrieved:', value);
        console.log('');

        // Test 2: SET with expiration
        console.log('Test 2: SET with expiration (10 seconds)');
        await redis.setex('temp_key', 10, 'This will expire');
        const tempValue = await redis.get('temp_key');
        console.log(' Temp value:', tempValue);
        const ttl = await redis.ttl('temp_key');
        console.log(' Time to live:', ttl, 'seconds');
        console.log('');

        // Test 3: EXISTS check
        console.log('Test 3: EXISTS check');
        const exists = await redis.exists('test_key');
        console.log(' Key exists:', exists === 1 ? 'Yes' : 'No');
        console.log('');

        // Test 4: Webhook simulation
        console.log('Test 4: Webhook idempotency simulation');
        const webhookId = 'webhook_test_12345';

        // First check
        const processed1 = await redis.exists(`webhook:${webhookId}`);
        console.log('First check - Already processed?', processed1 === 1 ? 'Yes' : 'No');

        // Mark as processed
        await redis.setex(`webhook:${webhookId}`, 86400, '1');
        console.log(' Webhook marked as processed');

        // Second check
        const processed2 = await redis.exists(`webhook:${webhookId}`);
        console.log('Second check - Already processed?', processed2 === 1 ? 'Yes' : 'No');
        console.log('');

        // Test 5: Delete test keys
        console.log('Test 5: Cleanup');
        await redis.del('test_key', 'temp_key', `webhook:${webhookId}`);
        console.log(' Test keys deleted');
        console.log('');

        console.log(' All tests passed! Upstash Redis is working correctly.');

    } catch (error) {
        console.error(' Test failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

testUpstash();