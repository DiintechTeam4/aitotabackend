require("dotenv").config();
const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Client = require("../models/Client");

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("Mongo URI not configured (MONGODB_URI/MONGO_URI missing).");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to DB");

  const aitota = await Workspace.findOne({
    name: { $regex: /^aitota$/i },
  }).select("_id name");

  if (!aitota) {
    throw new Error("AiTota workspace not found. Please create/check workspace first.");
  }

  const unassignedFilter = {
    $or: [
      { workspaceId: null },
      { workspaceId: { $exists: false } },
    ],
  };

  const unassignedCount = await Client.countDocuments(unassignedFilter);
  console.log(`Unassigned clients before migration: ${unassignedCount}`);

  if (unassignedCount === 0) {
    console.log("No unassigned clients found. Nothing to migrate.");
    return;
  }

  const updateRes = await Client.updateMany(unassignedFilter, {
    $set: { workspaceId: aitota._id },
  });

  console.log("Migration completed", {
    matched: updateRes.matchedCount,
    modified: updateRes.modifiedCount,
    targetWorkspace: String(aitota._id),
  });
}

run()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {}
  });

