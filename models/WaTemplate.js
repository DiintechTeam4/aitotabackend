const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    name: { type: String, required: true, trim: true },
    whatsappTemplateName: { type: String, required: true, trim: true },
    languageCode: { type: String, default: 'en' },
    bodyPreview: { type: String, default: '' },
    parameterFormat: { type: String, enum: ['NAMED', 'POSITIONAL'], default: 'NAMED' },
    sampleParams: [{ key: String, value: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('WaTemplate', templateSchema);
