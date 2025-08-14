const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  groupIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  clientId: {
    type: String,
    required: true,
    index: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: [ 'active', 'expired'],
    default: 'active'
  },
  // Array to store all unique IDs from campaign calls
  uniqueIds: [{
    type: String,
    index: true
  }],
  // Array to store campaign contacts (copied from groups but can be manipulated independently)
  contacts: [{
    _id: {type: mongoose.Schema.Types.ObjectId},
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: "" },
    addedAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual field to get current status based on dates
campaignSchema.virtual('currentStatus').get(function() {
  const now = new Date();
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  
   if (now >= start && now <= end) {
    return 'active';
  } else {
    return 'expired';
  }
});

// Method to update status based on dates
campaignSchema.methods.updateStatus = function() {
  const now = new Date();
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  
   if (now >= start && now <= end) {
    this.status = 'active';
  } else {
    this.status = 'expired';
  }
  
  return this.status;
};

// Update the updatedAt field before saving
campaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Auto-update status based on dates
  this.updateStatus();
  
  next();
});

// Ensure virtual fields are included when converting to JSON
campaignSchema.set('toJSON', { virtuals: true });
campaignSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Campaign', campaignSchema); 