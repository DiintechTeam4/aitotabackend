const axios = require('axios');

const TELEGRAM_ALERT_URL = 'https://telegram-bot-alert-module.onrender.com/api/telegram/send-text';

/**
 * Send a simple text alert to Telegram group.
 * Swallows errors to avoid impacting business flows.
 * @param {string} text
 */
async function sendTelegramAlert(text) {
  try {
    if (!text || typeof text !== 'string' || !text.trim()) return;
    await axios.post(TELEGRAM_ALERT_URL, { text });
  } catch (err) {
    // log once, but do not throw
    try {
      console.warn('Telegram alert failed:', err?.message);
    } catch (_) {}
  }
}

module.exports = { sendTelegramAlert };


