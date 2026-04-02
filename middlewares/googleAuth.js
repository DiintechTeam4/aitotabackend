const { OAuth2Client } = require('google-auth-library');

/**
 * All OAuth 2.0 client IDs that may appear as JWT `aud` for your app (web, Android, iOS).
 * Tokens only verify if the ID token's audience matches one of these.
 * Set GOOGLE_CLIENT_ID to your primary client, plus optional:
 * GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID,
 * or GOOGLE_CLIENT_IDS=comma,separated,list
 */
function getGoogleTokenAudiences() {
  const extra = (process.env.GOOGLE_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    ...extra
  ].filter(Boolean);
  return [...new Set(list)];
}

// Client ID only affects some OAuth flows; verifyIdToken uses explicit audience below
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID
);

/**
 * Middleware to verify Google ID token
 * This middleware validates the Google ID token sent from the Flutter app
 */
const verifyGoogleToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    const audience = getGoogleTokenAudiences();
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Google token is required'
      });
    }
    if (audience.length === 0) {
      console.error(
        'Google OAuth misconfiguration: set GOOGLE_CLIENT_ID and/or GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_CLIENT_IDS'
      );
      return res.status(500).json({
        success: false,
        message: 'Server Google OAuth is not configured'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience
    });

    const payload = ticket.getPayload();

    req.googleUser = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      googleToken: token
    };

    next();
  } catch (error) {
    const reason = error?.message || String(error);
    console.error('Google token verification error:', reason);
    if (process.env.NODE_ENV === 'development') {
      console.error(
        'Hint: ID token `aud` must match one of GOOGLE_CLIENT_ID / GOOGLE_WEB_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID. Web tokens use the Web OAuth client ID.'
      );
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid Google token',
      ...(process.env.NODE_ENV === 'development' && { detail: reason })
    });
  }
};


module.exports = {
  verifyGoogleToken,
};