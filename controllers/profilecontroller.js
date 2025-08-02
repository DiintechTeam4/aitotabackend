const Profile = require('../models/Profile');
const Client = require('../models/Client');

// Helper to check if all required fields are filled
function checkProfileCompleted(profile) {
  return !!(
    profile.businessName &&
    profile.businessType &&
    profile.contactNumber &&
    profile.contactName &&
    profile.pincode &&
    profile.city &&
    profile.state &&
    profile.website &&
    profile.pancard &&
    profile.gst &&
    profile.annualTurnover
  );
}

// Helper to validate profile data
function validateProfileData(data) {
  const errors = [];
  
  if (!data.businessName || data.businessName.trim().length === 0) {
    errors.push('Business name is required');
  }
  
  if (!data.businessType || data.businessType.trim().length === 0) {
    errors.push('Business type is required');
  }
  
  if (!data.contactNumber || data.contactNumber.trim().length === 0) {
    errors.push('Contact number is required');
  }
  
  if (!data.contactName || data.contactName.trim().length === 0) {
    errors.push('Contact name is required');
  }
  
  if (!data.pincode || data.pincode.trim().length === 0) {
    errors.push('Pincode is required');
  }
  
  if (!data.city || data.city.trim().length === 0) {
    errors.push('City is required');
  }
  
  if (!data.state || data.state.trim().length === 0) {
    errors.push('State is required');
  }
  
  return errors;
}

// Create a new profile
exports.createProfile = async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required',
        statusCode: 400
      });
    }

    // Validate profile data
    const validationErrors = validateProfileData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        statusCode: 400
      });
    }

    // Check if profile already exists for this client or human agent
    let existingProfile;
    if (req.body.humanAgentId) {
      // Check for human agent profile
      existingProfile = await Profile.findOne({ humanAgentId: req.body.humanAgentId });
      if (existingProfile) {
        return res.status(409).json({
          success: false,
          message: 'Profile already exists for this human agent. Use update endpoint to modify existing profile.',
          statusCode: 409
        });
      }
    } else {
      // Check for client profile
      existingProfile = await Profile.findOne({ clientId: req.client._id });
      if (existingProfile) {
        return res.status(409).json({
          success: false,
          message: 'Profile already exists for this client. Use update endpoint to modify existing profile.',
          statusCode: 409
        });
      }
    }

    // Prepare profile data
    const profileData = {
      ...req.body,
      clientId: req.body.humanAgentId ? undefined : req.client._id // Only set clientId if not human agent
    };

    // Check if all fields are filled
    profileData.isProfileCompleted = checkProfileCompleted(profileData);

    // Create and save profile
    const profile = new Profile(profileData);
    await profile.save();

    // Sync Client's isprofileCompleted field (only for client profiles)
    if (!req.body.humanAgentId) {
      await Client.findByIdAndUpdate(
        req.client._id,
        { isprofileCompleted: profile.isProfileCompleted },
        { new: true }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Profile created successfully',
      profile,
      statusCode: 201
    });

  } catch (error) {
    console.error('Profile creation error:', error);
    
    // Handle specific error types
    if (error.name === 'DuplicateProfileError') {
      return res.status(409).json({
        success: false,
        message: 'Profile already exists for this client',
        statusCode: 409
      });
    }
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        statusCode: 400
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      statusCode: 500
    });
  }
};

// Get a profile by clientId
exports.getProfile = async (req, res) => {
  try {
    // Validate clientId parameter
    if (!req.params.clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        statusCode: 400
      });
    }

    const profile = await Profile.findOne({ clientId: req.params.clientId });
    const clientEmail = await Client.findOne({ _id: req.params.clientId }).select('email');
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
        statusCode: 404
      });
    }

    // Sync Client's isprofileCompleted field
    await Client.findByIdAndUpdate(
      req.params.clientId,
      { isprofileCompleted: profile.isProfileCompleted },
      { new: false }
    );

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      email: clientEmail.email,
      profile,
      statusCode: 200
    });

  } catch (error) {
    console.error('Profile retrieval error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      statusCode: 500
    });
  }
};

// Update a profile by clientId
exports.updateProfile = async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required',
        statusCode: 400
      });
    }

    // Validate clientId parameter
    if (!req.params.clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        statusCode: 400
      });
    }

    // Validate profile data
    const validationErrors = validateProfileData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        statusCode: 400
      });
    }

    // Prevent clientId from being changed
    const updateData = { ...req.body };
    delete updateData.clientId;

    // Find the current profile
    const profile = await Profile.findOne({ clientId: req.params.clientId });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
        statusCode: 404
      });
    }

    // Merge updates
    Object.assign(profile, updateData);
    
    // Check if all fields are filled after update
    profile.isProfileCompleted = checkProfileCompleted(profile);
    
    await profile.save();

    // Sync Client's isprofileCompleted field
    await Client.findByIdAndUpdate(
      profile.clientId,
      { isprofileCompleted: profile.isProfileCompleted },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      profile,
      statusCode: 200
    });

  } catch (error) {
    console.error('Profile update error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        statusCode: 400
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      statusCode: 500
    });
  }
};

// Delete a profile by clientId
exports.deleteProfile = async (req, res) => {
  try {
    // Validate clientId parameter
    if (!req.params.clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format',
        statusCode: 400
      });
    }

    // First, find the profile to check if it exists
    const profile = await Profile.findOne({ clientId: req.params.clientId });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
        statusCode: 404
      });
    }

    // Set isProfileCompleted to false before deletion (for audit purposes)
    profile.isProfileCompleted = false;
    await profile.save();

    // Now delete the profile
    await Profile.findOneAndDelete({ clientId: req.params.clientId });

    // Update client's profile completion status to false
    await Client.findByIdAndUpdate(
      req.params.clientId,
      { isprofileCompleted: false },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile deleted successfully',
      statusCode: 200
    });

  } catch (error) {
    console.error('Profile deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      statusCode: 500
    });
  }
};

// Get all profiles (for admin purposes)
exports.getAllProfiles = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    
    const query = {};
    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { businessType: { $regex: search, $options: 'i' } }
      ];
    }

    const profiles = await Profile.find(query)
      .populate('clientId', 'email name')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Profile.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'Profiles retrieved successfully',
      profiles,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
      statusCode: 200
    });

  } catch (error) {
    console.error('Get all profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      statusCode: 500
    });
  }
}; 