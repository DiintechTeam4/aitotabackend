const mongoose = require('mongoose');

const WhatsAppTemplateRequestSchema = new mongoose.Schema(
  {
    requestClientId: { type: String, required: true, unique: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['requested', 'naven_processing', 'naven_ready', 'assigned', 'active', 'inactive', 'admin_rejected'],
      default: 'requested',
      index: true
    },
    templateUrl: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    navenResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    assignedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppTemplateRequest', WhatsAppTemplateRequestSchema);
