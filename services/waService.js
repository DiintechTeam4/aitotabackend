const axios = require('axios');
const Client = require('../models/Client');

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v19.0';

async function getCreds(clientId) {
  // Always use per-client credentials from DB
  const client = await Client.findById(clientId).select('+waAccessToken');
  if (!client?.waPhoneNumberId || !client?.waAccessToken) {
    const err = new Error('WhatsApp not connected. Add Phone Number ID and Access Token in Settings.');
    err.statusCode = 400;
    throw err;
  }
  return { phoneNumberId: client.waPhoneNumberId, token: client.waAccessToken };
}

function graphUrl(phoneNumberId, path = '') {
  const base = `https://graph.facebook.com/${apiVersion()}/${phoneNumberId}`;
  return path ? `${base}/${path}` : base;
}

async function sendTextMessage(clientId, to, message) {
  const { phoneNumberId, token } = await getCreds(clientId);
  const toNum = String(to).replace(/\D/g, '');
  const { data } = await axios.post(
    graphUrl(phoneNumberId, 'messages'),
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: toNum, type: 'text', text: { preview_url: false, body: String(message).slice(0, 4096) } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

function buildTemplateComponents(params, parameterFormat = 'NAMED') {
  if (!params || !params.length) return [{ type: 'body', parameters: [] }];
  const first = params[0];
  if (typeof first === 'string') {
    return [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }];
  }
  const fmt = String(parameterFormat || 'NAMED').toUpperCase() === 'POSITIONAL' ? 'POSITIONAL' : 'NAMED';
  if (fmt === 'POSITIONAL') {
    return [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p.text ?? p.value ?? '') })) }];
  }
  return [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p.text ?? p.value ?? ''), parameter_name: p.parameter_name || p.key })) }];
}

function normalizeLanguageCode(languageCode) {
  const raw = String(languageCode || '').trim();
  if (!raw) return 'en';
  return raw.replace(/-/g, '_');
}

/**
 * Resolve canonical template name + APPROVED language codes from Meta (fixes #132001:
 * wrong locale like en_US vs en, or local name test1 vs Meta test_1).
 */
async function resolveMetaTemplateForSend(clientId, templateName) {
  const wanted = String(templateName || '').trim();
  if (!wanted) return { metaName: wanted, languages: [] };
  try {
    const { phoneNumberId, token } = await getCreds(clientId);
    const ver = apiVersion();
    // Use ENV WABA ID directly if set
    let wabaId = process.env.WHATSAPP_WABA_ID;
    if (!wabaId) {
      const { data: phoneData } = await axios.get(`https://graph.facebook.com/${ver}/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'whatsapp_business_account' },
        timeout: 15000,
      });
      const waba = phoneData?.whatsapp_business_account;
      wabaId = waba?.id || waba;
    }
    if (!wabaId) return { metaName: wanted, languages: [] };

    const { data } = await axios.get(`https://graph.facebook.com/${ver}/${wabaId}/message_templates`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit: 200, fields: 'name,language,status' },
      timeout: 25000,
    });
    const list = (data?.data || []).filter((t) => t.status === 'APPROVED');

    let matches = list.filter(
      (t) => t.name === wanted || String(t.name).toLowerCase() === wanted.toLowerCase()
    );
    if (!matches.length) {
      const wNorm = wanted.toLowerCase().replace(/_/g, '');
      matches = list.filter((t) => String(t.name || '').toLowerCase().replace(/_/g, '') === wNorm);
    }

    if (!matches.length) return { metaName: wanted, languages: [] };

    const metaName = matches[0].name;
    const languages = [
      ...new Set(matches.map((t) => String(t.language || '').replace(/-/g, '_'))),
    ];
    return { metaName, languages };
  } catch (e) {
    console.warn('[WA_SEND] resolveMetaTemplateForSend:', e.response?.data?.error?.message || e.message);
    return { metaName: wanted, languages: [] };
  }
}

async function sendTemplateMessage(clientId, to, templateName, languageCode, params, parameterFormat = 'NAMED') {
  const { phoneNumberId, token } = await getCreds(clientId);
  const toNum = String(to).replace(/\D/g, '');
  const bodyParams = buildTemplateComponents(params, parameterFormat);

  const { metaName, languages: metaLangs } = await resolveMetaTemplateForSend(clientId, templateName);
  const primaryLanguage = normalizeLanguageCode(languageCode);
  const fallbackLanguages =
    primaryLanguage === 'en_US' ? ['en', 'en_GB'] : ['en_US', 'en', 'en_GB'];

  const tryOrder = [];
  for (const l of metaLangs) tryOrder.push(l);
  tryOrder.push(primaryLanguage);
  for (const l of fallbackLanguages) tryOrder.push(l);

  const seen = new Set();
  const uniqueLangs = [];
  for (const l of tryOrder) {
    if (!l || seen.has(l)) continue;
    seen.add(l);
    uniqueLangs.push(l);
  }

  const trySend = async (langCode) => {
    const templatePayload = { name: metaName, language: { code: langCode } };
    if (bodyParams[0]?.parameters?.length) templatePayload.components = bodyParams;
    const { data } = await axios.post(
      graphUrl(phoneNumberId, 'messages'),
      { messaging_product: 'whatsapp', to: toNum, type: 'template', template: templatePayload },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return data;
  };

  let lastErr;
  for (const lang of uniqueLangs) {
    try {
      return await trySend(lang);
    } catch (err) {
      lastErr = err;
      if (err.response?.data?.error?.code !== 132001) throw err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('No language candidates for template send');
}

async function sendInteractiveMessage(clientId, to, buttons, bodyText) {
  const { phoneNumberId, token } = await getCreds(clientId);
  const toNum = String(to).replace(/\D/g, '');
  const list = (buttons || []).slice(0, 3).map((b, i) => ({ type: 'reply', reply: { id: `btn_${i}`, title: String(b.title || b.label || b).slice(0, 20) } }));
  const { data } = await axios.post(
    graphUrl(phoneNumberId, 'messages'),
    { messaging_product: 'whatsapp', to: toNum, type: 'interactive', interactive: { type: 'button', body: { text: String(bodyText).slice(0, 1024) }, action: { buttons: list } } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

async function markMessageRead(clientId, messageId) {
  const { phoneNumberId, token } = await getCreds(clientId);
  const { data } = await axios.post(
    graphUrl(phoneNumberId, 'messages'),
    { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

module.exports = { sendTextMessage, sendTemplateMessage, sendInteractiveMessage, markMessageRead, getCreds };
