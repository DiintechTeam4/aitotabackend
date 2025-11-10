const mongoose = require('mongoose');

const MobileUserSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  lastSyncAt: {
    type: Date
  },
  preferences: {
    timezone: { type: String, default: 'Asia/Kolkata' },
    uploadOverWifiOnly: { type: Boolean, default: false }
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

MobileUserSchema.index({ clientId: 1, deviceId: 1 }, { unique: true });
MobileUserSchema.index({ clientId: 1, phoneNumber: 1 });

module.exports = mongoose.model('MobileUser', MobileUserSchema);


