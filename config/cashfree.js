const dotenv = require('dotenv');
const envConfig = require('./environment');
dotenv.config();

const ENV = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
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
  RETURN_URL: process.env.CASHFREE_RETURN_URL || `${envConfig.BACKEND_URL}/api/v1/cashfree/callback?order_id={order_id}`,
};


