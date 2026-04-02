const EndUser = require('../models/EndUser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

function getOtpSalt() {
  return (
    process.env.OTP_HASH_SALT ||
    process.env.JWT_SECRET ||
    'otp_hash_salt_default'
  );
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(otp) {
  const salt = getOtpSalt();
  return crypto.createHmac('sha256', salt).update(String(otp)).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhoneToE164(mobileNumber) {
  // Keep digits only
  let digits = String(mobileNumber || '').replace(/\D/g, '');
  if (!digits) return '';

  // If already has country prefix like 91xxxx... (common in India)
  if (digits.length === 10) {
    const cc = process.env.OTP_DEFAULT_COUNTRY_CODE || '+91';
    const ccNorm = String(cc).startsWith('+') ? String(cc) : `+${String(cc)}`;
    return `${ccNorm}${digits}`;
  }

  if (digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }

  // Fallback: assume digits already include country code
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return '';
}

async function sendBrevoEmailOtp({ toEmail, otp, subject }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL;
  const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME;

  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL || !BREVO_FROM_NAME) {
    throw new Error('Brevo is not configured (missing BREVO_API_KEY/BREVO_FROM_EMAIL/BREVO_FROM_NAME)');
  }

  const payload = {
    sender: { email: BREVO_FROM_EMAIL, name: BREVO_FROM_NAME },
    to: [{ email: toEmail }],
    subject: subject || 'Your OTP Code',
    htmlContent: `
      <div style="font-family: Arial, sans-serif;">
        <p>Your OTP code is: <b>${otp}</b></p>
        <p>This OTP is valid for a short time. If you didn’t request it, ignore this email.</p>
      </div>
    `
  };

  const resp = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    timeout: 15000
  });

  return resp.data;
}

async function sendWhatsAppOtpTemplate({ phoneE164, otp }) {
  // Allow disabling for environments without WhatsApp
  if (String(process.env.WHATSAPP_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('WhatsApp is disabled (WHATSAPP_ENABLED=false)');
  }

  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME;
  const WHATSAPP_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_TEMPLATE_NAME) {
    throw new Error('WhatsApp is not configured (missing WHATSAPP_TOKEN/WHATSAPP_PHONE_ID/WHATSAPP_TEMPLATE_NAME)');
  }

  // Many templates expect OTP in a "body" text parameter.
  // If your template uses a different component (header vs body), adjust components below.
  const payload = {
    messaging_product: 'whatsapp',
    to: phoneE164,
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otp }]
        }
      ]
    }
  };

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;
  const resp = await axios.post(url, payload, {
    params: { access_token: WHATSAPP_TOKEN },
    timeout: 20000
  });

  return resp.data;
}

function issueTokenForEndUser(user) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET not configured');

  return jwt.sign(
    { id: user._id, userType: 'endUser', email: user.email },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function getNextStep(user) {
  if (!user.emailVerified) return 'step1_verify_email_otp';
  if (!user.mobileVerified) return 'step2_send_mobile_otp';
  if (!user.profileCompleted) return 'step3_complete_profile';
  return 'completed';
}

async function registerStep1(req, res) {
  try {
    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const existing = await EndUser.findOne({ email: normEmail }).lean();
    if (existing) {
      const ok = await bcrypt.compare(String(password), existing.passwordHash);
      if (!ok) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      const token = issueTokenForEndUser(existing);
      return res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        nextStep: getNextStep(existing),
        user: {
          id: existing._id,
          email: existing.email,
          emailVerified: existing.emailVerified,
          mobileVerified: existing.mobileVerified,
          profileCompleted: existing.profileCompleted,
          mobileNumber: existing.mobileNumber
        }
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = await EndUser.create({
      email: normEmail,
      passwordHash,
      emailVerified: false,
      mobileVerified: false,
      profileCompleted: false,
      emailOtpHash: hashOtp(otp),
      emailOtpExpiresAt: expiresAt
    });

    await sendBrevoEmailOtp({
      toEmail: normEmail,
      otp,
      subject: 'AITOTA verification OTP'
    });

    return res.status(201).json({
      success: true,
      message: 'Email OTP sent',
      userId: user._id,
      emailVerified: false,
      emailOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('register step1 error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to start registration' });
  }
}

async function verifyEmailOtp(req, res) {
  try {
    const { email, otp } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailOtpHash || !user.emailOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'No email OTP pending' });
    }
    if (user.emailOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Email OTP expired' });
    }

    const ok = hashOtp(otp) === user.emailOtpHash;
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid email OTP' });

    user.emailVerified = true;
    user.emailOtpHash = null;
    user.emailOtpExpiresAt = null;
    await user.save();

    return res.json({ success: true, message: 'Email verified', nextStep: getNextStep(user) });
  } catch (error) {
    console.error('verifyEmailOtp error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to verify email OTP' });
  }
}

async function sendMobileOtp(req, res) {
  try {
    const { email, mobileNumber } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !mobileNumber) {
      return res.status(400).json({ success: false, message: 'email and mobileNumber are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified) {
      return res.status(400).json({ success: false, message: 'Verify email first' });
    }

    const phoneE164 = normalizePhoneToE164(mobileNumber);
    if (!phoneE164) {
      return res.status(400).json({ success: false, message: 'Invalid mobile number format' });
    }

    user.mobileNumber = phoneE164;

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    user.mobileOtpHash = hashOtp(otp);
    user.mobileOtpExpiresAt = expiresAt;
    await user.save();

    await sendWhatsAppOtpTemplate({ phoneE164, otp });

    return res.json({
      success: true,
      message: 'WhatsApp OTP sent',
      mobileOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('sendMobileOtp error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to send mobile OTP' });
  }
}

async function verifyMobileOtp(req, res) {
  try {
    const { email, otp } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.mobileOtpHash || !user.mobileOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'No mobile OTP pending' });
    }
    if (user.mobileOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Mobile OTP expired' });
    }

    const ok = hashOtp(otp) === user.mobileOtpHash;
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid mobile OTP' });

    user.mobileVerified = true;
    user.mobileOtpHash = null;
    user.mobileOtpExpiresAt = null;
    await user.save();

    return res.json({ success: true, message: 'Mobile verified', nextStep: getNextStep(user) });
  } catch (error) {
    console.error('verifyMobileOtp error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to verify mobile OTP' });
  }
}

async function completeProfile(req, res) {
  try {
    const { email, profile, profileImageUrl, profileImageKey } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !profile || typeof profile !== 'object') {
      return res.status(400).json({ success: false, message: 'email and profile object are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified) return res.status(400).json({ success: false, message: 'Verify email first' });
    if (!user.mobileVerified) return res.status(400).json({ success: false, message: 'Verify mobile first' });

    user.profile = profile;
    if (profileImageUrl) user.profileImageUrl = profileImageUrl;
    if (profileImageKey) user.profileImageKey = profileImageKey;
    user.profileCompleted = true;
    await user.save();

    const token = issueTokenForEndUser(user);

    return res.json({
      success: true,
      message: 'Registration completed',
      token,
      nextStep: 'completed',
      user: {
        id: user._id,
        email: user.email,
        mobileNumber: user.mobileNumber,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
        profileCompleted: user.profileCompleted,
        profile: user.profile,
        profileImageUrl: user.profileImageUrl
      }
    });
  } catch (error) {
    console.error('completeProfile error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to complete profile' });
  }
}

async function updateProfile(req, res) {
  try {
    const { email, profile } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !profile || typeof profile !== 'object') {
      return res.status(400).json({ success: false, message: 'email and profile are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified || !user.mobileVerified) {
      return res.status(400).json({ success: false, message: 'Verify email and mobile first' });
    }

    user.profile = profile;
    user.profileCompleted = true;
    await user.save();

    const token = issueTokenForEndUser(user);

    return res.json({
      success: true,
      message: 'Profile updated',
      token,
      user: {
        id: user._id,
        email: user.email,
        mobileNumber: user.mobileNumber,
        profileCompleted: user.profileCompleted,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error('updateProfile error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
}

async function updateProfileImage(req, res) {
  try {
    const { email, profileImageUrl, profileImageKey } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (profileImageUrl) user.profileImageUrl = profileImageUrl;
    if (profileImageKey) user.profileImageKey = profileImageKey;

    await user.save();

    return res.json({
      success: true,
      message: 'Profile image updated',
      user: {
        id: user._id,
        profileImageUrl: user.profileImageUrl,
        profileImageKey: user.profileImageKey
      }
    });
  } catch (error) {
    console.error('updateProfileImage error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to update profile image' });
  }
}

async function loginEmailPassword(req, res) {
  try {
    const { email, password } = req.body || {};
    const normEmail = normalizeEmail(email);

    if (!normEmail || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = issueTokenForEndUser(user);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      nextStep: getNextStep(user),
      user: {
        id: user._id,
        email: user.email,
        mobileNumber: user.mobileNumber,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
        profileCompleted: user.profileCompleted,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error('loginEmailPassword error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
}

async function requestForgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail) return res.status(400).json({ success: false, message: 'email is required' });

    const user = await EndUser.findOne({ email: normEmail });
    // Don't reveal existence
    if (!user) {
      return res.json({ success: true, message: 'If the email exists, an OTP will be sent.' });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.resetOtpHash = hashOtp(otp);
    user.resetOtpExpiresAt = expiresAt;
    await user.save();

    await sendBrevoEmailOtp({
      toEmail: normEmail,
      otp,
      subject: 'Your password reset OTP'
    });

    return res.json({ success: true, message: 'OTP sent for password reset.', resetOtpExpiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('requestForgotPassword error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to request password reset' });
  }
}

async function resetForgotPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body || {};
    const normEmail = normalizeEmail(email);

    if (!normEmail || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'email, otp and newPassword are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await EndUser.findOne({ email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.resetOtpHash || !user.resetOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'No reset OTP pending' });
    }
    if (user.resetOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Reset OTP expired' });
    }

    const ok = hashOtp(otp) === user.resetOtpHash;
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid OTP' });

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    await user.save();

    const token = issueTokenForEndUser(user);

    return res.json({ success: true, message: 'Password reset successful', token });
  } catch (error) {
    console.error('resetForgotPassword error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
}

module.exports = {
  registerStep1,
  verifyEmailOtp,
  sendMobileOtp,
  verifyMobileOtp,
  completeProfile,
  updateProfile,
  updateProfileImage,
  loginEmailPassword,
  requestForgotPassword,
  resetForgotPassword
};

