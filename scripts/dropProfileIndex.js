const mongoose = require('mongoose');
require('dotenv').config();

async function dropProfileIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get the database instance
    const db = mongoose.connection.db;
    
    // Drop the problematic index
    const result = await db.collection('profiles').dropIndex('clientId_1');
    console.log('Successfully dropped clientId_1 index:', result);
    
    // List remaining indexes to verify
    const indexes = await db.collection('profiles').indexes();
    console.log('Remaining indexes:', indexes.map(idx => idx.name));
    
  } catch (error) {
    console.error('Error dropping index:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

dropProfileIndex(); 