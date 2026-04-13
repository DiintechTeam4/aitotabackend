require("dotenv").config();
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.log("⚠️ fixCampaignValidation: Mongo URI not found, skipping.");
    return;
  }

  await mongoose.connect(mongoUri);
  console.log("✅ fixCampaignValidation: DB connected");

  // Defensive maintenance for legacy campaigns:
  // if details/status fields were partially missing, initialize them.
  const campaigns = await Campaign.find({
    $or: [{ details: { $exists: false } }, { details: null }],
  }).select("_id details");

  let patched = 0;
  for (const campaign of campaigns) {
    campaign.details = Array.isArray(campaign.details) ? campaign.details : [];
    await campaign.save();
    patched += 1;
  }

  console.log(
    `✅ fixCampaignValidation: completed. patched_campaigns=${patched}`
  );
}

run()
  .catch((err) => {
    console.error("❌ fixCampaignValidation failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {}
  });

