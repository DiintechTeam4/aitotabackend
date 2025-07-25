const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' , required: true},
  businessName: { type: String, required: true },
  businessType: { type: String, required: true },
  contactNumber: { type: String, required: true },
  contactName: { type: String, required: true },
  address: { type: String, required: true },
  website: { type: String },
  pancard: { type: String },
  gst: { type: String },
  annualTurnover: { type: String },
  isProfileCompleted: { type: Boolean, default: false, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Profile', ProfileSchema); 