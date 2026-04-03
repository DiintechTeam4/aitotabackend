const mongoose = require('mongoose');

const EndUserSchema = new mongoose.Schema(
  {
    clientId: {
      // Store Client.userId (e.g. "CLI6474...") as string.
      // This keeps "client.userId only everywhere" consistent across all user APIs.
      type: String,
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },

    mobileNumber: {
      type: String,
      default: null,
      index: true
    },

    emailVerified: { type: Boolean, default: false },
    mobileVerified: { type: Boolean, default: false },
    profileCompleted: { type: Boolean, default: false },

    // OTP state
    emailOtpHash: { type: String, default: null },
    emailOtpExpiresAt: { type: Date, default: null },
    mobileOtpHash: { type: String, default: null },
    mobileOtpExpiresAt: { type: Date, default: null },

    resetOtpHash: { type: String, default: null },
    resetOtpExpiresAt: { type: Date, default: null },

    // Profile
    profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    profileImageUrl: { type: String, default: null },
    profileImageKey: { type: String, default: null }
  },
  { timestamps: true }
);

EndUserSchema.index({ clientId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('EndUser', EndUserSchema);

