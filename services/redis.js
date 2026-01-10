const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis with REST API
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Test connection (optional, but helpful for debugging)
const testConnection = async () => {
    try {
        await redis.set('test_connection', 'OK', { ex: 60 });
        const result = await redis.get('test_connection');
        if (result === 'OK') {
            console.log('Upstash Redis connected successfully');
        }
    } catch (error) {
        console.error('Upstash Redis connection failed:', error.message);
    }
};

// Run test on startup
testConnection();

module.exports = redis;