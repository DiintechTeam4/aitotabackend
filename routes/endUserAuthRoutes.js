const express = require('express');
const router = express.Router();
const {
  registerStep1,
  verifyEmailOtp,
  sendMobileOtp,
  verifyMobileOtp,
  completeProfile,
  updateProfileImage,
  loginEmailPassword,
  requestForgotPassword,
  resetForgotPassword
} = require('../controllers/endUserAuthController');

// Step 1: email + password -> send email OTP
router.post('/register/step1', registerStep1);

// Verify email OTP
router.post('/register/step1/verify-email-otp', verifyEmailOtp);

// Step 2: send WhatsApp OTP to mobile number
router.post('/register/step2/send-mobile-otp', sendMobileOtp);

// Verify WhatsApp OTP
router.post('/register/step2/verify-mobile-otp', verifyMobileOtp);

// Step 3: complete profile details
router.post('/register/step3/complete-profile', completeProfile);

// Step 4 (optional): upload/update profile image
router.post('/register/step4/profile-image', updateProfileImage);

// Update profile (email only)
router.post('/profile/update', updateProfile);

// Update profile image (email only)
router.post('/profile/image/update', updateProfileImage);

// Login with email + password
router.post('/login/email-password', loginEmailPassword);

// Forget password (email OTP)
router.post('/forgot-password/request', requestForgotPassword);
router.post('/forgot-password/reset', resetForgotPassword);

module.exports = router;

