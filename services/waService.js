const axios = require('axios');
const Client = require('../models/Client');

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v19.0';

async function getCreds(clientId) {
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

function buildTemplateComponents(params) {
  if (!params || !params.length) return [{ type: 'body', parameters: [] }];
  const first = params[0];
  if (typeof first === 'string') {
    return [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }];
  }
  return [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p.text ?? p.value ?? ''), parameter_name: p.parameter_name || p.key })) }];
}

async function sendTemplateMessage(clientId, to, templateName, languageCode, params) {
  const { phoneNumberId, token } = await getCreds(clientId);
  const toNum = String(to).replace(/\D/g, '');
  const bodyParams = buildTemplateComponents(params);
  const templatePayload = { name: templateName, language: { code: languageCode || 'en' } };
  if (bodyParams[0]?.parameters?.length) templatePayload.components = bodyParams;
  const { data } = await axios.post(
    graphUrl(phoneNumberId, 'messages'),
    { messaging_product: 'whatsapp', to: toNum, type: 'template', template: templatePayload },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
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
