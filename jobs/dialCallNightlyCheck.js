const cron = require("node-cron");
const axios = require("axios");
const { sendAlertMail } = require("../utils/mailer");

/**
 * STEP 1: Generate API Token
 */
const generateApiToken = async () => {
  const response = await axios.post(
    process.env.SAN_GET_TOKEN_URL,
    {
      access_key: process.env.SAN_ACCESS_KEY
    },
    {
      headers: {
        Accesstoken: process.env.SAN_ACCESS_TOKEN,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  const apiToken = response?.data?.Apitoken || response?.data?.apitoken;

  if (!apiToken) {
    throw new Error("Failed to generate Apitoken");
  }

  return apiToken;
};

/**
 * STEP 2: Call Dial Call API
 */
const callDialApi = async (apiToken) => {
  const payload = {
    appid: 2,
    call_to: "07702366289",
    caller_id: "6122403",
    custom_field: {
      uniqueid: `aidial-${Date.now()}`,
      name: "health-check"
    }
  };

  const response = await axios.post(
    process.env.SAN_DIAL_CALL_URL,
    payload,
    {
      headers: {
        Apitoken: apiToken,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return response.data;
};

/**
 * MAIN HEALTH CHECK
 */
const checkDialCallAPI = async () => {
  console.log("🕛 [CRON] Dial Call Health Check Started");

  try {
    // 1️⃣ Generate token
    const apiToken = await generateApiToken();
    console.log("✅ Apitoken generated");

    // 2️⃣ Call dial API
    const dialResponse = await callDialApi(apiToken);

    if (!dialResponse || typeof dialResponse !== "object") {
      throw new Error("Dial Call API returned invalid response");
    }

    console.log("✅ Dial Call API working properly");
  } catch (error) {
    console.error("❌ Dial Call API FAILED:", error.message);

    await sendAlertMail(
      "🚨 Dial Call API Failure (Nightly Monitor)",
      `
        <h2>Dial Call API Health Check Failed</h2>
        <p><b>Time:</b> ${new Date().toISOString()}</p>
        <p><b>Error:</b> ${error.message}</p>
        <p><b>Environment:</b> AWS</p>
        <p>Please investigate immediately.</p>
      `
    );
  }
};

/**
 * CRON SCHEDULER
 */
const startDialCallCron = () => {
  cron.schedule(
    "* * * * *",
    checkDialCallAPI,
    { timezone: "Asia/Kolkata" }
  );

  console.log("⏰ Dial Call Cron scheduled (12:00 AM IST)");
};

module.exports = {
  startDialCallCron,
  checkDialCallAPI // exported for manual testing
};
