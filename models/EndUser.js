const mongoose = require('mongoose');

const EndUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
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

module.exports = mongoose.model('EndUser', EndUserSchema);

