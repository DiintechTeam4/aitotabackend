const mongoose = require("mongoose");

const humanAgentSchema = new mongoose.Schema({
  // Client reference
  clientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Client', 
    required: true, 
    index: true 
  },

  // Personal Information
  humanAgentName: { 
    type: String, 
    required: true 
  },
  email: { 
    type: String, 
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  mobileNumber:{
    type:String,
    required: true
  },
  did:{
    type:String,
  },

  // Status flags
  isprofileCompleted: { 
    type: Boolean, 
    default: false 
  },
  isApproved: { 
    type: Boolean, 
    default: false 
  },

  // Agent IDs array (initially null/empty)
  agentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  }],

  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update the updatedAt field before saving
humanAgentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for client + human agent name uniqueness
humanAgentSchema.index({ clientId: 1, humanAgentName: 1 }, { unique: true });


module.exports = mongoose.model("HumanAgent", humanAgentSchema); 