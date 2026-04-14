const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String },
    businessName: { type: String },
    websiteUrl: { type: String },
    city: { type: String },
    pincode: { type: String },
    gstNo: { type: String },
    panNo: { type: String },
    mobileNo: { type: String },
    address: { type: String },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    tabs: [{
        name: { type: String, required: true },
        icon: { type: String }, // Icon class name or key
        path: { type: String },
        isActive: { type: Boolean, default: true }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Workspace', workspaceSchema);
