/**
 * Run this script ONCE to drop global unique indexes from Client collection.
 * After this, same email/mobile/gst/pan can exist in different workspaces.
 * 
 * Usage: node scripts/dropClientEmailUniqueIndex.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection('clients');

  // Drop all globally unique indexes that should be workspace-scoped
  const indexesToDrop = ['email_1', 'mobileNo_1', 'gstNo_1', 'panNo_1'];
  
  for (const indexName of indexesToDrop) {
    try {
      await collection.dropIndex(indexName);
      console.log(`✅ Dropped index: ${indexName}`);
    } catch (e) {
      if (e.code === 27) {
        console.log(`ℹ️  Index ${indexName} does not exist, skipping`);
      } else {
        console.error(`❌ Error dropping ${indexName}:`, e.message);
      }
    }
  }

  // Create compound indexes: field + workspaceId (unique per workspace)
  // Only email needs compound uniqueness; mobileNo/gstNo/panNo validation is done in code
  try {
    await collection.createIndex(
      { email: 1, workspaceId: 1 },
      { unique: true, sparse: true, name: 'email_workspaceId_unique' }
    );
    console.log('✅ Created compound index: email_workspaceId_unique');
  } catch (e) {
    if (e.code === 85 || e.code === 86) {
      console.log('ℹ️  Index email_workspaceId_unique already exists, skipping');
    } else {
      console.error('❌ Error creating email_workspaceId_unique:', e.message);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

run().catch(console.error);
