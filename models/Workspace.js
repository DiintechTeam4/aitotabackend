const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String },
    appId: { type: String, unique: true, sparse: true },
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

// Auto-generate appId like CLI pattern: APP + timestamp + random
workspaceSchema.pre('save', async function (next) {
    if (this.isNew && !this.appId) {
        try {
            let appId;
            let isUnique = false;
            let attempts = 0;
            while (!isUnique && attempts < 10) {
                const timestamp = Date.now().toString().slice(-6);
                const randomString = Math.random().toString(36).substr(2, 4).toUpperCase();
                appId = `APP${timestamp}${randomString}`;
                const existing = await this.constructor.findOne({ appId });
                if (!existing) isUnique = true;
                attempts++;
            }
            if (!isUnique) appId = `APP${Date.now()}${Math.floor(Math.random() * 1000)}`;
            this.appId = appId;
        } catch (error) {
            return next(error);
        }
    }
    next();
});

module.exports = mongoose.model('Workspace', workspaceSchema);
