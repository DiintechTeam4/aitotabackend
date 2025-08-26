// config/cashfree.js
const dotenv = require('dotenv');
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  CLIENT_ID: isProduction 
    ? process.env.CASHFREE_CLIENT_ID 
    : process.env.CASHFREE_CLIENT_ID_TEST,
  CLIENT_SECRET: isProduction 
    ? process.env.CASHFREE_SECRET_KEY 
    : process.env.CASHFREE_SECRET_KEY_TEST,
  BASE_URL: isProduction 
    ? 'https://api.cashfree.com' 
    : 'https://sandbox.cashfree.com',
  ENVIRONMENT: isProduction ? 'production' : 'sandbox'
};

console.log(`🏦 Cashfree initialized in ${config.ENVIRONMENT} mode`);

module.exports = config;