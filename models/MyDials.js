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

const MyDialSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
  },
  humanAgentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "humanAgent",
  },
  category:{
    type: String,
    require: true,
  },
  subCategory:{
    type: String,
    require: true,
  },
  leadStatus:{
    type: String,
    required: true
  },
  other:{
    type: String,
  },
  phoneNumber:{
    type: String,
    require: true
  },
  normalizedPhoneNumber: {
    type: String,
    index: true,
    default: ""
  },
  contactName:{
    type: String,
    require: true
  },
  age:{
    type: Number,
    default: 0
  },
  date:{
    type: String,
  },
  duration:{
    type: Number,
    default: 0
  },
  explanation:{
    type: String,
  },
  profession:{
    type: String, 
  },
  gender:{
    type: String,
  },
  pincode:{
    type: String,
  },
  city:{
    type: String,
  }
},{
    timestamps: true
});

MyDialSchema.statics.normalizePhoneNumber = normalizePhoneNumberValue;

MyDialSchema.pre("save", function(next) {
  this.normalizedPhoneNumber = normalizePhoneNumberValue(this.phoneNumber);
  next();
});

for (const hook of ["findOneAndUpdate", "updateOne", "updateMany"]) {
  MyDialSchema.pre(hook, function(next) {
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

MyDialSchema.index({ clientId: 1, humanAgentId: 1, normalizedPhoneNumber: 1, createdAt: -1 });

module.exports = mongoose.model("MyDial", MyDialSchema);