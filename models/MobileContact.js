const mongoose = require('mongoose');

const MobileContactSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  mobileUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
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
  tags: [{
    type: String,
    trim: true
  }],
  source: {
    type: String,
    enum: ['mobile_share', 'manual', 'import'],
    default: 'mobile_share'
  },
  lastSharedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

MobileContactSchema.index({ clientId: 1, mobileUserId: 1, phoneNumber: 1 }, { unique: true });
MobileContactSchema.index({ clientId: 1, phoneNumber: 1 });

module.exports = mongoose.model('MobileContact', MobileContactSchema);


