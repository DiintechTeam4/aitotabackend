const dotenv = require('dotenv');
dotenv.config();

// Check for conflicting environment variables
const envFromEnv = process.env.CASHFREE_ENV;
if (envFromEnv) {
  console.log('CASHFREE_ENV from environment:', envFromEnv);
}

// Force production environment if we have production credentials
let ENV = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();

// If we have production credentials, force production environment
if (process.env.CASHFREE_CLIENT_ID && !process.env.CASHFREE_CLIENT_ID.startsWith('TEST')) {
  ENV = 'prod';
  console.log('Forcing production environment due to production credentials');
}
const BASE_URL = ENV === 'prod' || ENV === 'production'
  ? 'https://api.cashfree.com'
  : 'https://sandbox.cashfree.com';

module.exports = {
  ENV,
  BASE_URL,
  CLIENT_ID: (ENV === 'prod' || ENV === 'production')
    ? process.env.CASHFREE_CLIENT_ID
    : process.env.CASHFREE_CLIENT_ID_TEST,
  CLIENT_SECRET: (ENV === 'prod' || ENV === 'production')
    ? process.env.CASHFREE_SECRET_KEY
    : process.env.CASHFREE_SECRET_KEY_TEST,
  RETURN_URL: process.env.CASHFREE_RETURN_URL || `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/v1/cashfree/callback`,
};


