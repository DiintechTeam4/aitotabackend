const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
  orderId: { type: String, required: true, unique: true, index: true },
  planKey: { type: String },
  amount: { type: Number, default: 0 },
  email: { type: String },
  phone: { type: String },
  status: { type: String, enum: ['INITIATED', 'SUCCESS', 'FAILED', 'PENDING'], default: 'INITIATED' },
  transactionId: { type: String },
  responseCode: { type: String },
  responseMsg: { type: String },
  gateway: { type: String, default: 'paytm' },
  credited: { type: Boolean, default: false },
  creditsAdded: { type: Number, default: 0 },
  rawCallback: { type: Object },
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);


