const EndUser = require('../models/EndUser');
const Client = require('../models/Client');
const { getobject, uploadBuffer } = require('../utils/r2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const {
  mergeFieldsWithLocked,
  validateProfilePayload,
  isValidClientId
} = require('../utils/endUserProfileFields');

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

function maskEmail(email) {
  const e = normalizeEmail(email);
  const [name, domain] = e.split('@');
  if (!name || !domain) return '***';
  if (name.length <= 2) return `${name[0] || '*'}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (!p) return '***';
  if (p.length <= 4) return '***';
  return `${p.slice(0, 3)}****${p.slice(-3)}`;
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

function toWhatsAppRecipient(phoneE164) {
  // WhatsApp Cloud API expects recipient in international format digits (wa_id), usually without '+'.
  return String(phoneE164 || '').replace(/\D/g, '');
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

  const recipientWaId = toWhatsAppRecipient(phoneE164);
  if (!recipientWaId) {
    throw new Error('Invalid WhatsApp recipient (empty wa_id after normalization)');
  }

  // Many templates expect OTP in body and/or URL button parameter.
  // This supports both with env-based control to avoid hardcoding template internals.
  const includeBodyParam = String(process.env.WHATSAPP_INCLUDE_BODY_PARAM || 'true').toLowerCase() === 'true';
  const includeUrlButtonParam =
    String(process.env.WHATSAPP_INCLUDE_URL_BUTTON_PARAM || 'true').toLowerCase() === 'true';
  const buttonIndex = Number(process.env.WHATSAPP_URL_BUTTON_INDEX || 0);
  const buttonValue = String(process.env.WHATSAPP_URL_BUTTON_VALUE || otp);

  const components = [];
  if (includeBodyParam) {
    components.push({
      type: 'body',
      parameters: [{ type: 'text', text: otp }]
    });
  }
  if (includeUrlButtonParam) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(Number.isNaN(buttonIndex) ? 0 : buttonIndex),
      parameters: [{ type: 'text', text: buttonValue }]
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientWaId,
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
      components
    }
  };

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;
  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });

  return resp.data;
}

function issueTokenForEndUser(user) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET not configured');

  return jwt.sign(
    {
      id: user._id,
      userType: 'endUser',
      email: user.email,
      clientId: String(user.clientId)
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

async function getMergedFieldsForClientId(clientId) {
  if (!isValidClientId(clientId)) return null;
  const client = await Client.findOne({ userId: clientId })
    .select('endUserProfileFields userId businessName name')
    .lean();
  if (!client) return null;
  return mergeFieldsWithLocked(client.endUserProfileFields);
}

async function getPublicProfileFields(req, res) {
  try {
    const { clientId } = req.params || {};
    if (!isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid clientId' });
    }
    const client = await Client.findOne({ userId: clientId }).select('_id userId businessName name').lean();
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const fields = await getMergedFieldsForClientId(clientId);
    return res.json({
      success: true,
      clientId: String(client.userId),
      clientName: client.businessName || client.name || '',
      fields
    });
  } catch (e) {
    console.error('getPublicProfileFields:', e?.message || e);
    return res.status(500).json({ success: false, message: 'Failed to load profile fields' });
  }
}

function getNextStep(user) {
  if (!user.emailVerified) return 'step1_verify_email_otp';
  if (!user.mobileVerified) return 'step2_send_mobile_otp';
  if (!user.profileCompleted) return 'step3_complete_profile';
  return 'completed';
}

function messageForNextStep(nextStep) {
  switch (nextStep) {
    case 'step1_verify_email_otp':
      return 'Verify your email using the OTP sent to your inbox.';
    case 'step2_send_mobile_otp':
      return 'Email verified. Continue with mobile number and WhatsApp OTP.';
    case 'step3_complete_profile':
      return 'Mobile verified. Complete your profile details.';
    case 'completed':
      return 'Registration complete.';
    default:
      return 'Continue registration.';
  }
}

async function getTenantClientByUserId(clientIdStr) {
  if (!isValidClientId(clientIdStr)) return null;
  return Client.findOne({ userId: clientIdStr })
    .select('isApproved userId email businessName name')
    .lean();
}

/**
 * End-user JWT is only issued when the tenant Client is admin-approved (`isApproved`).
 */
function respondClientNotApproved(res) {
  return res.status(403).json({
    success: false,
    code: 'CLIENT_NOT_APPROVED',
    message:
      'This partner account is pending admin approval. You cannot log in until it is approved.',
    clientApproved: false
  });
}

/**
 * Email-only check: login + token if user finished all steps and tenant is approved;
 * otherwise return registration progress (no password).
 */
async function checkEmailAccess(req, res) {
  try {
    const { clientId, email } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const tenant = await getTenantClientByUserId(clientId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    if (!tenant.isApproved) {
      return respondClientNotApproved(res);
    }

    let user = await EndUser.findOne({ clientId, email: normEmail }).lean();
    if (!user) {
      return res.json({
        success: true,
        action: 'not_registered',
        clientApproved: true,
        nextStep: 'step1_register',
        message: 'No account for this email yet. Start registration with email and password.',
        token: null,
        user: null
      });
    }

    // Google login: email is already verified by Google, skip email OTP step
    if (!user.emailVerified) {
      await EndUser.findByIdAndUpdate(user._id, {
        emailVerified: true,
        emailOtpHash: null,
        emailOtpExpiresAt: null
      });
      user = { ...user, emailVerified: true };
    }

    const nextStep = getNextStep(user);
    if (nextStep === 'completed') {
      const token = issueTokenForEndUser(user);
      return res.json({
        success: true,
        action: 'login',
        message: 'Login successful',
        clientApproved: true,
        token,
        userType: 'endUser',
        role: 'endUser',
        nextStep: 'completed',
        user: {
          id: user._id,
          clientId: user.clientId,
          email: user.email,
          userType: 'endUser',
          role: 'endUser',
          mobileNumber: user.mobileNumber,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified,
          profileCompleted: user.profileCompleted,
          profile: user.profile,
          profileImageUrl: user.profileImageUrl
        }
      });
    }

    return res.json({
      success: true,
      action: 'continue_registration',
      clientApproved: true,
      nextStep,
      message: messageForNextStep(nextStep),
      token: null,
      user: {
        id: user._id,
        clientId: user.clientId,
        email: user.email,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
        profileCompleted: user.profileCompleted,
        mobileNumber: user.mobileNumber
      }
    });
  } catch (e) {
    console.error('checkEmailAccess error:', e?.message || e);
    return res.status(500).json({ success: false, message: 'Failed to check email' });
  }
}

function assignIfNonEmptyString(doc, field, value) {
  if (value === undefined || value === null) return;
  const s = String(value).trim();
  if (s === '') return;
  doc[field] = s;
}

/**
 * Tenant (Client) updates business/profile fields from their app before/after signup.
 * Accepts `multipart/form-data` (recommended for logo upload) or JSON.
 * Form fields: clientUserId, email, name, businessName, mobileNo, address, city, pincode,
 * websiteUrl, gstNo, panNo, businessLogoKey (optional if file uploaded)
 * File field name: **businessLogo** (single image, max ~10MB)
 * Requires `clientUserId` + `email` to match the Client record.
 */
async function clientOnboardingProfile(req, res) {
  try {
    const {
      clientUserId,
      email,
      name,
      businessName,
      mobileNo,
      address,
      city,
      pincode,
      websiteUrl,
      gstNo,
      panNo,
      businessLogoKey
    } = req.body || {};

    const normEmail = normalizeEmail(email);
    if (!clientUserId || !isValidClientId(clientUserId)) {
      return res.status(400).json({ success: false, message: 'Valid clientUserId is required' });
    }
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const client = await Client.findOne({ userId: clientUserId });
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    if (normalizeEmail(client.email) !== normEmail) {
      return res.status(403).json({
        success: false,
        message: 'Email does not match this client account'
      });
    }

    assignIfNonEmptyString(client, 'name', name);
    assignIfNonEmptyString(client, 'businessName', businessName);
    assignIfNonEmptyString(client, 'mobileNo', mobileNo);
    assignIfNonEmptyString(client, 'address', address);
    assignIfNonEmptyString(client, 'city', city);
    assignIfNonEmptyString(client, 'pincode', pincode);
    assignIfNonEmptyString(client, 'websiteUrl', websiteUrl);
    assignIfNonEmptyString(client, 'gstNo', gstNo);
    assignIfNonEmptyString(client, 'panNo', panNo);

    if (req.file && req.file.buffer && req.file.buffer.length) {
      const safeName = String(req.file.originalname || 'logo')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      const key = `businessLogo/${Date.now()}_${safeName}`;
      await uploadBuffer(key, req.file.buffer, req.file.mimetype || 'image/jpeg');
      client.businessLogoKey = key;
      try {
        client.businessLogoUrl = await getobject(key);
      } catch (err) {
        console.error('clientOnboardingProfile getobject:', err?.message || err);
      }
    } else if (businessLogoKey && String(businessLogoKey).trim()) {
      client.businessLogoKey = String(businessLogoKey).trim();
      try {
        client.businessLogoUrl = await getobject(client.businessLogoKey);
      } catch (err) {
        console.error('clientOnboardingProfile getobject:', err?.message || err);
      }
    }

    await client.save();

    return res.json({
      success: true,
      message: 'Client profile updated',
      clientApproved: !!client.isApproved,
      client: {
        userId: client.userId,
        email: client.email,
        name: client.name,
        businessName: client.businessName,
        businessLogoUrl: client.businessLogoUrl,
        mobileNo: client.mobileNo,
        address: client.address,
        city: client.city,
        pincode: client.pincode,
        websiteUrl: client.websiteUrl,
        gstNo: client.gstNo,
        panNo: client.panNo,
        isApproved: client.isApproved
      }
    });
  } catch (e) {
    console.error('clientOnboardingProfile error:', e?.message || e);
    return res.status(500).json({ success: false, message: 'Failed to update client profile' });
  }
}

async function registerStep1(req, res) {
  try {
    const { clientId, email, password } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const clientExists = await Client.findOne({ userId: clientId }).select('userId').lean();
    if (!clientExists) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const existing = await EndUser.findOne({ clientId, email: normEmail }).lean();
    if (existing) {
      const ok = await bcrypt.compare(String(password), existing.passwordHash);
      if (!ok) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      const nextStep = getNextStep(existing);

      // If registration not complete, resend the appropriate OTP and return next step
      if (nextStep !== 'completed') {
        // Resend email OTP if email not verified
        if (!existing.emailVerified) {
          const otp = generateOtp();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
          await EndUser.findByIdAndUpdate(existing._id, {
            emailOtpHash: hashOtp(otp),
            emailOtpExpiresAt: expiresAt
          });
          await sendBrevoEmailOtp({ toEmail: normEmail, otp, subject: 'AITOTA verification OTP' });
        }
        return res.status(200).json({
          success: true,
          message: messageForNextStep(nextStep),
          token: null,
          nextStep,
          user: {
            id: existing._id,
            clientId: existing.clientId,
            email: existing.email,
            emailVerified: existing.emailVerified,
            mobileVerified: existing.mobileVerified,
            profileCompleted: existing.profileCompleted,
            mobileNumber: existing.mobileNumber
          }
        });
      }

      const tenant = await getTenantClientByUserId(clientId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
      if (!tenant.isApproved) {
        return respondClientNotApproved(res);
      }

      const token = issueTokenForEndUser(existing);
      return res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        userType: 'endUser',
        role: 'endUser',
        nextStep,
        user: {
          id: existing._id,
          clientId: existing.clientId,
          email: existing.email,
          userType: 'endUser',
          role: 'endUser',
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
      clientId,
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
      clientId: String(clientId),
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
    const { clientId, email, otp } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
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

async function resendEmailOtp(req, res) {
  try {
    const { clientId, email } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified. Continue with mobile verification.'
      });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.emailOtpHash = hashOtp(otp);
    user.emailOtpExpiresAt = expiresAt;
    await user.save();

    await sendBrevoEmailOtp({
      toEmail: normEmail,
      otp,
      subject: 'AITOTA verification OTP'
    });

    return res.json({
      success: true,
      message: 'A new verification OTP has been sent to your email.',
      nextStep: 'step1_verify_email_otp',
      emailOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('resendEmailOtp error:', {
      message: error?.message || 'unknown_error',
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to resend email OTP at the moment. Please try again shortly.'
    });
  }
}

async function sendMobileOtp(req, res) {
  try {
    const { clientId, email, mobileNumber } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !mobileNumber) {
      return res.status(400).json({ success: false, message: 'email and mobileNumber are required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
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
      message: 'WhatsApp OTP has been sent to your mobile number.',
      nextStep: 'step2_send_mobile_otp',
      mobileOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    const { clientId, email, mobileNumber } = req.body || {};
    const normalizedPhone = normalizePhoneToE164(mobileNumber);
    console.error('sendMobileOtp error:', {
      clientId: clientId || null,
      email: maskEmail(email),
      mobile: maskPhone(normalizedPhone || mobileNumber),
      message: error?.message || 'unknown_error',
      code: error?.code || null,
      responseStatus: error?.response?.status || null,
      responseData: error?.response?.data || null,
      responseErrorData: error?.response?.data?.error?.error_data || null,
      requestSummary: {
        whatsappEnabled: String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true',
        phoneIdConfigured: !!process.env.WHATSAPP_PHONE_ID,
        templateName: process.env.WHATSAPP_TEMPLATE_NAME || null,
        templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
        waRecipient: maskPhone(toWhatsAppRecipient(normalizedPhone || mobileNumber))
      },
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to send mobile OTP right now. Please try again in a moment.'
    });
  }
}

async function resendMobileOtp(req, res) {
  try {
    const { clientId, email, mobileNumber } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !mobileNumber) {
      return res.status(400).json({ success: false, message: 'email and mobileNumber are required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified) {
      return res.status(400).json({ success: false, message: 'Verify email first' });
    }
    if (user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile is already verified. Continue with profile completion.'
      });
    }

    const phoneE164 = normalizePhoneToE164(mobileNumber);
    if (!phoneE164) {
      return res.status(400).json({ success: false, message: 'Invalid mobile number format' });
    }

    user.mobileNumber = phoneE164;

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    user.mobileOtpHash = hashOtp(otp);
    user.mobileOtpExpiresAt = expiresAt;
    await user.save();

    await sendWhatsAppOtpTemplate({ phoneE164, otp });

    return res.json({
      success: true,
      message: 'A new WhatsApp OTP has been sent to your mobile number.',
      nextStep: 'step2_send_mobile_otp',
      mobileOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    const { clientId, email, mobileNumber } = req.body || {};
    const normalizedPhone = normalizePhoneToE164(mobileNumber);
    console.error('resendMobileOtp error:', {
      clientId: clientId || null,
      email: maskEmail(email),
      mobile: maskPhone(normalizedPhone || mobileNumber),
      message: error?.message || 'unknown_error',
      code: error?.code || null,
      responseStatus: error?.response?.status || null,
      responseData: error?.response?.data || null,
      responseErrorData: error?.response?.data?.error?.error_data || null,
      requestSummary: {
        whatsappEnabled: String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true',
        phoneIdConfigured: !!process.env.WHATSAPP_PHONE_ID,
        templateName: process.env.WHATSAPP_TEMPLATE_NAME || null,
        templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
        waRecipient: maskPhone(toWhatsAppRecipient(normalizedPhone || mobileNumber))
      },
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to resend mobile OTP right now. Please try again in a moment.'
    });
  }
}

async function verifyMobileOtp(req, res) {
  try {
    const { clientId, email, otp } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
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
    const {
      clientId, email, profile, profileImageUrl, profileImageKey, mobileNumber,
      businessName, businessType, contactNumber, contactName,
      pincode, city, state, website, pancard, gst, annualTurnover
    } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified) return res.status(400).json({ success: false, message: 'Verify email first' });
    if (!user.mobileVerified) return res.status(400).json({ success: false, message: 'Verify mobile first' });

    // Save business profile fields directly
    if (businessName !== undefined) user.businessName = businessName;
    if (businessType !== undefined) user.businessType = businessType;
    if (contactNumber !== undefined) user.contactNumber = contactNumber;
    if (contactName !== undefined) user.contactName = contactName;
    if (pincode !== undefined) user.pincode = pincode;
    if (city !== undefined) user.city = city;
    if (state !== undefined) user.state = state;
    if (website !== undefined) user.website = website;
    if (pancard !== undefined) user.pancard = pancard;
    if (gst !== undefined) user.gst = gst;
    if (annualTurnover !== undefined) user.annualTurnover = annualTurnover;
    if (profileImageUrl) user.profileImageUrl = profileImageUrl;
    if (profileImageKey) user.profileImageKey = profileImageKey;

    // Also handle legacy profile object if sent
    if (profile && typeof profile === 'object') {
      const mergedFields = await getMergedFieldsForClientId(clientId);
      if (mergedFields) {
        const normalizedProfile = { ...profile };
        if (mobileNumber !== undefined && normalizedProfile.mobileNo === undefined) {
          normalizedProfile.mobileNo = mobileNumber;
        }
        const { sanitized } = validateProfilePayload(normalizedProfile, mergedFields);
        user.profile = sanitized;
      }
    }

    user.profileCompleted = true;
    user.isProfileCompleted = true;
    await user.save();

    const tenant = await getTenantClientByUserId(clientId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    let token = null;
    let message = 'Registration completed';
    if (tenant.isApproved) {
      token = issueTokenForEndUser(user);
    } else {
      message =
        'Profile saved. Login will be available after admin approves this partner account.';
    }

    return res.json({
      success: true,
      message,
      token,
      userType: 'endUser',
      role: 'endUser',
      pendingAdminApproval: !tenant.isApproved,
      nextStep: 'completed',
      user: {
        id: user._id,
        clientId: user.clientId,
        email: user.email,
        userType: 'endUser',
        role: 'endUser',
        mobileNumber: user.mobileNumber,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
        profileCompleted: user.profileCompleted,
        isProfileCompleted: user.isProfileCompleted,
        profile: user.profile,
        profileImageUrl: user.profileImageUrl,
        businessName: user.businessName,
        businessType: user.businessType,
        contactNumber: user.contactNumber,
        contactName: user.contactName,
        pincode: user.pincode,
        city: user.city,
        state: user.state,
        website: user.website,
        pancard: user.pancard,
        gst: user.gst,
        annualTurnover: user.annualTurnover
      }
    });
  } catch (error) {
    console.error('completeProfile error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to complete profile' });
  }
}

async function updateProfile(req, res) {
  try {
    const { clientId, email, profile } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !profile || typeof profile !== 'object') {
      return res.status(400).json({ success: false, message: 'email and profile are required' });
    }

    const mergedFields = await getMergedFieldsForClientId(clientId);
    if (!mergedFields) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified || !user.mobileVerified) {
      return res.status(400).json({ success: false, message: 'Verify email and mobile first' });
    }

    const prev = user.profile && typeof user.profile === 'object' ? user.profile : {};
    const { errors, sanitized } = validateProfilePayload({ ...prev, ...profile }, mergedFields);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('; ') });
    }

    user.profile = sanitized;
    user.profileCompleted = true;
    await user.save();

    const tenant = await getTenantClientByUserId(clientId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    let token = null;
    let message = 'Profile updated';
    if (tenant.isApproved) {
      token = issueTokenForEndUser(user);
    } else {
      message =
        'Profile updated. Login will be available after admin approves this partner account.';
    }

    return res.json({
      success: true,
      message,
      token,
      pendingAdminApproval: !tenant.isApproved,
      user: {
        id: user._id,
        clientId: user.clientId,
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
    const { clientId, email, profileImageUrl, profileImageKey } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
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
    const { clientId, email, password } = req.body || {};
    const normEmail = normalizeEmail(email);

    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const tenant = await getTenantClientByUserId(clientId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    if (!tenant.isApproved) {
      return respondClientNotApproved(res);
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = issueTokenForEndUser(user);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      userType: 'endUser',
      role: 'endUser',
      nextStep: getNextStep(user),
      user: {
        id: user._id,
        clientId: user.clientId,
        email: user.email,
        userType: 'endUser',
        role: 'endUser',
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
    const { clientId, email } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) return res.status(400).json({ success: false, message: 'email is required' });

    const user = await EndUser.findOne({ clientId, email: normEmail });
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

async function resendForgotPasswordOtp(req, res) {
  try {
    const { clientId, email } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail) return res.status(400).json({ success: false, message: 'email is required' });

    const user = await EndUser.findOne({ clientId, email: normEmail });
    // Keep account existence private.
    if (!user) {
      return res.json({
        success: true,
        message: 'If the email is registered, a new OTP will be sent for password reset.'
      });
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

    return res.json({
      success: true,
      message: 'A new OTP has been sent for password reset.',
      resetOtpExpiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('resendForgotPasswordOtp error:', {
      message: error?.message || 'unknown_error',
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to resend reset OTP at the moment. Please try again shortly.'
    });
  }
}

async function verifyForgotPasswordOtp(req, res) {
  try {
    const { clientId, email, otp } = req.body || {};
    const normEmail = normalizeEmail(email);

    if (!clientId || !isValidClientId(clientId)) {
      return res.status(400).json({ success: false, message: 'Valid clientId is required' });
    }
    if (!normEmail || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const user = await EndUser.findOne({ clientId, email: normEmail });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.resetOtpHash || !user.resetOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'No reset OTP pending. Request a new one.' });
    }
    if (user.resetOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Reset OTP expired. Request a new one.' });
    }

    const ok = hashOtp(otp) === user.resetOtpHash;
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid OTP' });

    // OTP verified — issue a short-lived reset token (do NOT clear hash yet, cleared on password reset)
    const resetToken = jwt.sign(
      { id: user._id, email: user.email, clientId: user.clientId, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.json({
      success: true,
      message: 'OTP verified. You can now reset your password.',
      resetToken
    });
  } catch (error) {
    console.error('verifyForgotPasswordOtp error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
  }
}

async function resetForgotPassword(req, res) {
  try {
    const { resetToken, newPassword } = req.body || {};

    if (!resetToken) {
      return res.status(400).json({ success: false, message: 'resetToken is required' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'newPassword must be at least 6 characters' });
    }

    // Verify resetToken issued by verifyForgotPasswordOtp
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Reset token is invalid or expired. Request a new OTP.' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }

    const user = await EndUser.findById(decoded.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    await user.save();

    return res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('resetForgotPassword error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
}

module.exports = {
  registerStep1,
  verifyEmailOtp,
  resendEmailOtp,
  sendMobileOtp,
  resendMobileOtp,
  verifyMobileOtp,
  completeProfile,
  updateProfile,
  updateProfileImage,
  loginEmailPassword,
  requestForgotPassword,
  resendForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetForgotPassword,
  getPublicProfileFields,
  checkEmailAccess,
  clientOnboardingProfile
};

