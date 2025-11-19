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
  category: {
    type: String,
    trim: true
  },
  isRunning: {
    type: Boolean,
    default: false
  },
  agent: [{
    type: String,
    trim: true
  }],
  groupIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  // Ownership: who owns this campaign (client or humanAgent)
  ownerType: {
    type: String,
    enum: ['client', 'humanAgent'],
    required: false,
    default: 'client',
    index: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    index: true
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  // Array to store detailed call information for campaign calls
  details: [{
    uniqueId: { 
      type: String, 
      required: true,
      index: true 
    },
    contactId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Contact'
      // Removed required: true to make it optional
    },
    time: { 
      type: Date, 
      default: Date.now 
    },
    status: { 
      type: String, 
      enum: ['ringing', 'ongoing', 'completed'], 
      default: 'ringing' 
    },
    runId:{
      type: String,
      required: false
    },
    leadStatus: {
      type: String,
      enum: [
        // Connected - Interested
        'vvi',                    // very very interested
        'maybe',                  // maybe
        'enrolled',               // enrolled
        
        // Connected - Not Interested
        'junk_lead',              // junk lead
        'not_required',           // not required
        'enrolled_other',         // enrolled other
        'decline',                // decline
        'not_eligible',           // not eligible
        'wrong_number',           // wrong number
        
        // Connected - Followup
        'hot_followup',           // hot followup
        'cold_followup',          // cold followup
        'schedule',               // schedule
        
        // Not Connected
        'not_connected'           // not connected
      ],
      default: 'not_connected'
    },
  }],
  // Array to store campaign contacts (copied from groups but can be manipulated independently)
  contacts: [{
    _id: {type: mongoose.Schema.Types.ObjectId},
    name: { type: String, required: false, default: '' },
    phone: { type: String, required: true },
    status: { type: String, enum: ['default', 'interested', 'maybe', 'not interested'], default: 'default' },
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

// Index for better performance on status queries
campaignSchema.index({ 'details.status': 1 });

// Ensure virtual fields are included when converting to JSON
campaignSchema.set('toJSON', { virtuals: true });
campaignSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Campaign', campaignSchema); 

// Compound index for fast listing by ownership and recency
campaignSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });