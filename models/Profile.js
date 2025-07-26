const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
  clientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Client', 
    required: true,
    unique: true 
  },
  businessName: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  businessType: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 50
  },
  contactNumber: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 20
  },
  contactName: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  pincode: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 10
  },
  city: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  state: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  website: { 
    type: String,
    trim: true,
    maxlength: 200
  },
  pancard: { 
    type: String,
    trim: true,
    maxlength: 10,
    uppercase: true
  },
  gst: { 
    type: String,
    trim: true,
    maxlength: 15,
    uppercase: true
  },
  annualTurnover: { 
    type: String,
    trim: true,
    maxlength: 50
  },
  isProfileCompleted: { 
    type: Boolean, 
    default: false, 
    required: true 
  },
}, { 
  timestamps: true,
  // Add compound index for better performance
  indexes: [
    { clientId: 1 }
  ]
});

// Pre-save middleware to ensure clientId is unique
ProfileSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existingProfile = await this.constructor.findOne({ clientId: this.clientId });
    if (existingProfile) {
      const error = new Error('Profile already exists for this client');
      error.name = 'DuplicateProfileError';
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('Profile', ProfileSchema); 