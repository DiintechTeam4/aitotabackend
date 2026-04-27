require("dotenv").config();
const mongoose = require("mongoose");
const Client = require("../models/Client");
const Workspace = require("../models/Workspace");

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);

  const ws = await Workspace.findOne({ name: /^aitota$/i }).lean();
  if (!ws) throw new Error("AiTota workspace not found");

  const clients = await Client.find({ workspaceId: ws._id })
    .select("name businessName businessLogoUrl businessLogoKey")
    .limit(20)
    .lean();

  const total = await Client.countDocuments({ workspaceId: ws._id });
  const withUrl = await Client.countDocuments({
    workspaceId: ws._id,
    businessLogoUrl: { $exists: true, $ne: "" },
  });
  const withKey = await Client.countDocuments({
    workspaceId: ws._id,
    businessLogoKey: { $exists: true, $ne: "" },
  });

  console.log({ workspaceId: String(ws._id), total, withUrl, withKey });
  console.log(clients);
  await mongoose.connection.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

