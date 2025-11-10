const mongoose = require('mongoose');

const callStatuses = [
  'connected',
  'missed',
  'rejected',
  'not_picked_by_client',
  'never_attended'
];

const callDirections = ['incoming', 'outgoing'];

const MobileCallLogSchema = new mongoose.Schema({
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
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileContact'
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  contactName: {
    type: String,
    trim: true
  },
  direction: {
    type: String,
    enum: callDirections,
    required: true
  },
  status: {
    type: String,
    enum: callStatuses,
    default: 'connected'
  },
  startedAt: {
    type: Date,
    required: true,
    index: true
  },
  endedAt: {
    type: Date
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  callResult: {
    type: String,
    trim: true
  },
  externalId: {
    type: String,
    trim: true
  },
  notes: {
    type: String
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

MobileCallLogSchema.index({ clientId: 1, mobileUserId: 1, startedAt: -1 });
MobileCallLogSchema.index({ clientId: 1, mobileUserId: 1, externalId: 1 }, { unique: true, sparse: true });

/**
 * Helper to compute duration automatically before saving when endedAt provided.
 */
MobileCallLogSchema.pre('save', function (next) {
  if (!this.durationSeconds && this.startedAt && this.endedAt) {
    this.durationSeconds = Math.max(0, Math.round((this.endedAt - this.startedAt) / 1000));
  }
  next();
});

module.exports = {
  MobileCallLog: mongoose.model('MobileCallLog', MobileCallLogSchema),
  callStatuses,
  callDirections
};


