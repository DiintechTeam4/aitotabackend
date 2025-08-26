const dotenv = require('dotenv');
dotenv.config();

// Production URLs - Update these for your deployment
const PRODUCTION_URLS = {
  BACKEND_URL: process.env.BACKEND_URL || 'https://api.aitota.com', // Replace with your actual backend domain
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://app.aitota.com',
  PAYMENT_SUCCESS_PATH: process.env.PAYMENT_SUCCESS_PATH || '/auth/dashboard'
};

// Development URLs
const DEVELOPMENT_URLS = {
  BACKEND_URL: 'http://localhost:4000',
  FRONTEND_URL: 'http://localhost:5173',
  PAYMENT_SUCCESS_PATH: '/auth/dashboard'
};

// Determine environment
const isProduction = process.env.NODE_ENV === 'production' || 
                    process.env.ENVIRONMENT === 'production' ||
                    process.env.BACKEND_URL?.includes('https://');

// Export appropriate URLs
const config = isProduction ? PRODUCTION_URLS : DEVELOPMENT_URLS;

// Override with environment variables if provided
config.BACKEND_URL = process.env.BACKEND_URL || config.BACKEND_URL;
config.FRONTEND_URL = process.env.FRONTEND_URL || config.FRONTEND_URL;
config.PAYMENT_SUCCESS_PATH = process.env.PAYMENT_SUCCESS_PATH || config.PAYMENT_SUCCESS_PATH;

module.exports = config;
