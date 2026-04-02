const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');

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

/**
 * Normalize client-sent ID token: trim, strip Bearer, ensure three JWT segments.
 * Corrupted tokens (extra whitespace, line breaks, wrong encoding) often yield
 * "Invalid token signature" from google-auth-library.
 */
function normalizeGoogleIdToken(raw) {
  if (raw == null) return '';
  let s = typeof raw === 'string' ? raw : String(raw);
  s = s.trim();
  s = s.replace(/^\s*Bearer\s+/i, '');
  s = s.replace(/\s+/g, '');
  const parts = s.split('.');
  if (parts.length !== 3) {
    throw new Error('ID token must have three segments (header.payload.signature)');
  }
  return s;
}

function base64UrlToJson(segment) {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  return JSON.parse(buf.toString('utf8'));
}

/**
 * When local RSA verify fails, ask Google to validate the token (same trust model as fetching JWKS).
 * Set GOOGLE_DISABLE_TOKENINFO_FALLBACK=true to disable (library-only verification).
 */
async function verifyIdTokenViaGoogleTokeninfo(idToken, allowedAudiences) {
  const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
    params: { id_token: idToken },
    timeout: 15000
  });

  if (data.error) {
    throw new Error(data.error_description || String(data.error));
  }

  const rawAud = data.aud;
  const audList = Array.isArray(rawAud) ? rawAud : rawAud != null ? [String(rawAud)] : [];
  const audOk = audList.some((a) => allowedAudiences.includes(a));
  if (!audOk) {
    throw new Error('Wrong recipient, payload audience != requiredAudience');
  }

  const iss = data.iss || '';
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new Error('Invalid issuer');
  }

  if (data.exp != null) {
    const exp = Number(data.exp);
    if (Number.isFinite(exp) && Date.now() / 1000 > exp + 120) {
      throw new Error('Token used too late');
    }
  }

  return {
    getPayload: () => ({
      sub: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
      email_verified: data.email_verified === true || data.email_verified === 'true'
    })
  };
}

const googleClientSingleton = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID
);

async function verifyGoogleIdToken(idToken, audience) {
  try {
    return await googleClientSingleton.verifyIdToken({ idToken, audience });
  } catch (first) {
    const msg = first?.message || String(first);
    const isSigOrCert =
      /Invalid token signature/i.test(msg) ||
      /No pem found for envelope/i.test(msg) ||
      /Failed to retrieve verification certificates/i.test(msg);

    if (isSigOrCert) {
      try {
        const fresh = new OAuth2Client(audience[0]);
        return await fresh.verifyIdToken({ idToken, audience });
      } catch (second) {
        if (process.env.GOOGLE_DISABLE_TOKENINFO_FALLBACK === 'true') {
          throw second;
        }
        console.warn(
          'Google verifyIdToken failed after retry; using tokeninfo fallback:',
          second?.message || second
        );
        try {
          return await verifyIdTokenViaGoogleTokeninfo(idToken, audience);
        } catch (tokeninfoErr) {
          // Log Google response to help distinguish: wrong token type vs audience/issuer mismatch vs corrupted token
          console.error(
            'Google tokeninfo fallback failed:',
            tokeninfoErr?.response?.data || tokeninfoErr?.message || tokeninfoErr
          );
          throw second; // keep original signature failure as the root-cause
        }
      }
    }

    if (process.env.GOOGLE_DISABLE_TOKENINFO_FALLBACK === 'true') {
      throw first;
    }
    if (/Wrong recipient|Invalid issuer|Token used too late|too early/i.test(msg)) {
      throw first;
    }
    try {
      return await verifyIdTokenViaGoogleTokeninfo(idToken, audience);
    } catch {
      throw first;
    }
  }
}

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

    const idToken = normalizeGoogleIdToken(token);
    // Lightweight integrity checks for debugging (won't leak token contents)
    const parts = idToken.split('.');
    let decodedClaims = null;
    let decodedHeader = null;
    try {
      decodedClaims = base64UrlToJson(parts[1]);
    } catch {
      // ignore decode errors; token might be corrupted in transit
    }
    try {
      decodedHeader = base64UrlToJson(parts[0]);
    } catch {
      // ignore
    }
    const exp = decodedClaims && decodedClaims.exp ? Number(decodedClaims.exp) : null;
    const iat = decodedClaims && decodedClaims.iat ? Number(decodedClaims.iat) : null;
    const nowSec = Date.now() / 1000;
    const signature = parts[2] || '';
    const expInSeconds = exp ? Math.round(exp - nowSec) : null;
    console.log('Google ID token integrity:', {
      tokenLen: idToken.length,
      parts: parts.length,
      hasWhitespace: /\s/.test(idToken),
      hasPlus: idToken.includes('+'),
      hasSlash: idToken.includes('/'),
      hasEquals: idToken.includes('='),
      hasPercent: idToken.includes('%'),
      signatureLen: signature.length,
      signatureStart: signature.slice(0, 12),
      signatureEnd: signature.slice(-12),
      header: decodedHeader
        ? {
            alg: decodedHeader.alg,
            kid: decodedHeader.kid,
            typ: decodedHeader.typ
          }
        : null,
      exp,
      iat,
      expInSeconds,
      aud: decodedClaims?.aud ? String(decodedClaims.aud).slice(0, 40) : null
    });

    // Fail fast with a clearer error when the token is already expired
    // (prevents confusing "Invalid token signature" logs).
    if (typeof expInSeconds === 'number' && expInSeconds < -30) {
      return res.status(401).json({
        success: false,
        message: 'Google token expired',
        expInSeconds
      });
    }
    const ticket = await verifyGoogleIdToken(idToken, audience);
    const payload = ticket.getPayload();

    req.googleUser = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      googleToken: idToken
    };

    next();
  } catch (error) {
    const reason = error?.message || String(error);
    console.error('Google token verification error:', reason);
    if (process.env.NODE_ENV === 'development') {
      console.error(
        'Hint: Send the ID token (JWT from Google), not the OAuth access_token. Ensure `aud` matches a configured OAuth client ID.'
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
  normalizeGoogleIdToken,
  getGoogleTokenAudiences
};
