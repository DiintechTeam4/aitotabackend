const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    name: { type: String, required: true, trim: true },
    targetGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'WaContactGroup', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'WaTemplate', required: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'completed', 'failed'],
      default: 'draft',
    },
    scheduledAt: { type: Date, default: null },
    totalContacts: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WaCampaign', campaignSchema);
