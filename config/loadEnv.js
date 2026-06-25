const path = require('path');
const dotenv = require('dotenv');

// Default to 'development' if NODE_ENV is not set
const nodeEnv = process.env.NODE_ENV || 'development';

// 1. Load environment-specific configuration
dotenv.config({ path: path.resolve(__dirname, '..', `.env.${nodeEnv}`) });

// 2. Load fallback default configuration for shared secrets/keys
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

console.log(`Loaded configuration for environment: ${nodeEnv}`);
