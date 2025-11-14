const mongoose = require("mongoose");

const normalizePhoneNumberValue = (phone) => {
  if (!phone) return "";
  const digitsOnly = String(phone).replaceAll(/\D/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.length > 10) {
    return digitsOnly.slice(-10);
  }
  return digitsOnly;
};

const ContactProfileSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    humanAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "humanAgent",
      index: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    normalizedPhoneNumber: {
      type: String,
      index: true,
      default: "",
    },
    contactName: {
      type: String,
      default: "",
    },
    age: {
      type: Number,
      default: "",
    },
    profession: {
      type: String,
      default: "",
    },
    gender: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    pincode: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // This automatically adds createdAt and updatedAt
  }
);

// Pre-save hook to normalize phone number
ContactProfileSchema.pre("save", function(next) {
  this.normalizedPhoneNumber = normalizePhoneNumberValue(this.phoneNumber);
  next();
});

// Pre-update hooks to normalize phone number
for (const hook of ["findOneAndUpdate", "updateOne", "updateMany"]) {
  ContactProfileSchema.pre(hook, function(next) {
    const update = this.getUpdate() || {};

    const extractPhone = (payload) => {
      if (!payload) return undefined;
      if (Object.hasOwn(payload, "phoneNumber")) {
        return payload.phoneNumber;
      }
      return undefined;
    };

    let phoneNumber = extractPhone(update);
    if (phoneNumber === undefined && update.$set) {
      phoneNumber = extractPhone(update.$set);
    }

    if (phoneNumber !== undefined) {
      const normalized = normalizePhoneNumberValue(phoneNumber);
      if (!update.$set) {
        update.$set = {};
      }
      update.$set.normalizedPhoneNumber = normalized;
      this.setUpdate(update);
    }

    next();
  });
}

// Unique index: One profile per phone number globally
// Contact is same person regardless of which client calls them
ContactProfileSchema.index({ normalizedPhoneNumber: 1 }, { unique: true });

// Additional indexes for faster queries
ContactProfileSchema.index({ clientId: 1, humanAgentId: 1 });

module.exports = mongoose.model("ContactProfile", ContactProfileSchema);

