const cron = require("node-cron");
const axios = require("axios");
const { sendAlertMail } = require("../utils/mailer");

const API_URL = process.env.DIAL_CALL_API_URL;

/**
 * Calls Dial Call API and validates response
 */
const checkDialCallAPI = async () => {
  console.log("🕛 [CRON] Dial Call Health Check started");

  try {
    const response = await axios.get(API_URL, {
      timeout: 15000
    });

    const data = response?.data;

    // ❌ Null / empty / invalid response
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      throw new Error("API returned NULL or EMPTY response");
    }

    console.log("✅ [CRON] Dial Call API is healthy");
  } catch (error) {
    console.error("❌ [CRON] Dial Call API failed:", error.message);

    await sendAlertMail(
      "🚨 Dial Call API DOWN (Nightly Check)",
      `
      <h2>Dial Call API Health Check Failed</h2>
      <p><b>Time:</b> ${new Date().toISOString()}</p>
      <p><b>Error:</b> ${error.message}</p>
      <p><b>API:</b> ${API_URL}</p>
      <p>Please check immediately.</p>
      `
    );
  }
};

/**
 * Schedule job at 12:00 AM IST daily
 */
const startDialCallCron = () => {
  cron.schedule(
    "0 0 * * *",
    checkDialCallAPI,
    {
      timezone: "Asia/Kolkata"
    }
  );

  console.log("⏰ Dial Call Cron scheduled for 12:00 AM IST");
};

module.exports = { startDialCallCron };
