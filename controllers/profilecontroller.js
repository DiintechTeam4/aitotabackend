const Profile = require('../models/Profile');
const Client = require('../models/Client');
const HumanAgent = require('../models/HumanAgent');
const { getobject } = require('../utils/s3');

// Helper to construct address from city, state, pincode
function constructAddress(data) {
  const addressParts = [];
  if (data.city) addressParts.push(data.city);
  if (data.state) addressParts.push(data.state);
  if (data.pincode) addressParts.push(data.pincode);
  return addressParts.length > 0 ? addressParts.join(', ') : (data.address || '');
}

// Helper to check if all required fields are filled
function checkProfileCompleted(profile) {
  // Construct address from city, state, pincode if address is not directly provided
  const address = profile.address || constructAddress(profile);
  
  return !!(
    profile.businessName &&
    profile.businessType &&
    profile.contactNumber &&
    profile.contactName &&
    address &&
    profile.website &&
    profile.pancard &&
    profile.annualTurnover
    // gst is now optional, so removed from check
  );
}

// Helper to validate profile data
function validateProfileData(data) {
  const errors = [];
  const requiredFields = [
    'businessName',
    'businessType',
    'contactNumber',
    'contactName',
    'website',
    'pancard',
    'annualTurnover'
  ];

  for (const f of requiredFields) {
    if (!data[f] || String(data[f]).trim().length === 0) {
      errors.push(`${f} is required`);
    }
  }

  // Check if address can be constructed from city, state, pincode or if address is provided
  const constructedAddress = constructAddress(data);
  if (!constructedAddress || constructedAddress.trim().length === 0) {
    errors.push('address is required (provide city, state, pincode, or address field)');
  }

  // Light format checks
  if (data.website && !/^https?:\/\//i.test(data.website)) {
    errors.push('website must start with http:// or https://');
  }
  // Removed pancard format validation - accepting any pancard value
  // Removed gst format validation - gst is now optional
  if (data.contactNumber && String(data.contactNumber).replace(/\D/g, '').length < 10) {
    errors.push('contactNumber appears invalid');
  }

  return errors;
}

// Create a new profile
exports.createProfile = async (req, res) => {
  try {
    // Log the incoming request body for debugging
    console.log('=== createProfile API - Request Body ===');
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Request body values:', Object.values(req.body || {}));
    console.log('========================================');
    
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required',
        statusCode: 400
      });
    }

    // If humanAgentId is present, allow minimal profile creation (skip full validation)
    let validationErrors = [];
    if (req.body.humanAgentId) {
      // Only require minimal fields for human agent profile
      const minimalFields = ['businessName', 'contactNumber', 'role', 'contactName', 'humanAgentId'];
      console.log('Validating minimal fields for human agent profile');
      for (const f of minimalFields) {
        if (!req.body[f] || String(req.body[f]).trim().length === 0) {
          validationErrors.push(`${f} is required`);
          console.log(`Validation error: ${f} is missing or empty. Value received:`, req.body[f]);
        }
      }
    } else {
      // Validate full profile data for client
      console.log('Validating full profile data for client');
      validationErrors = validateProfileData(req.body);
    }
    if (validationErrors.length > 0) {
      console.log('=== Validation Errors ===');
      console.log('Validation errors:', validationErrors);
      console.log('=========================');
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

    // Construct address from city, state, pincode if address is not directly provided
    if (!profileData.address && (profileData.city || profileData.state || profileData.pincode)) {
      profileData.address = constructAddress(profileData);
      console.log('Constructed address from city, state, pincode:', profileData.address);
    }

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

// Get a profile by profileId
exports.getProfile = async (req, res) => {
  try {
    // Validate profileId parameter
    if (!req.params.profileId) {
      return res.status(400).json({
        success: false,
        message: 'Profile ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid profile ID format',
        statusCode: 400
      });
    }

    let profile = await Profile.findById(req.params.profileId);
    
    // If profile not found, try treating the ID as clientId (fallback)
    if (!profile) {
      try {
        const client = await Client.findById(req.params.profileId);
        if (client) {
          // Generate client logo URL if possible
          // Always generate a fresh URL on each request
          let logoUrl = null;
          try {
            if (client.businessLogoKey) {
              logoUrl = await getobject(client.businessLogoKey);
            }
          } catch (_) {}

          // Return client data as fallback
          return res.status(200).json({
            statusCode: 200,
            success: true,
            message: 'Client data retrieved successfully (fallback)',
            email: client.email,
            role: 'client',
            profile: {
              _id: client._id,
              clientId: client._id,
              businessName: client.businessName,
              email: client.email,
              contactNumber: client.mobileNo,
              contactName: client.name,
              address: client.address,
              clientLogo: logoUrl || null,
              businessLogoKey: client.businessLogoKey || null,
              gstNo: client.gstNo,
              panNo: client.panNo,
              role: 'client',
              city: client.city,
              pincode: client.pincode,
              isProfileCompleted: client.isprofileCompleted || false,
              createdAt: client.createdAt,
              updatedAt: client.updatedAt
            },
          });
        }
      } catch (clientError) {
        console.error('Error finding client as fallback:', clientError);
      }
      
      // If neither profile nor client found
      return res.status(404).json({
        success: false,
        message: 'Profile or Client not found',
        statusCode: 404
      });
    }

    // Get human email and role if profile has humanAgentId
    let clientEmail = null;
    let role = null;
    let businessLogoKey = null;
    let clientLogo = null;
    if (profile.humanAgentId) {
      const humanAgent = await HumanAgent.findById(profile.humanAgentId).select('email role');
      clientEmail = humanAgent ? humanAgent.email : null;
      role = humanAgent ? humanAgent.role : null;
    } else if (profile.clientId) {
      try {
        const client = await Client.findById(profile.clientId).select('email businessLogoKey');
        if (client) {
          clientEmail = client.email;
          role = 'client'; // Set role as 'client' for client profiles
          businessLogoKey = client.businessLogoKey || null;
          // Always generate a fresh URL on each request
          let logoUrl = null;
          try {
            if (client.businessLogoKey) {
              logoUrl = await getobject(client.businessLogoKey);
            }
          } catch (_) {}
          clientLogo = logoUrl;
        } else {
          clientEmail = null;
          role = null;
        }
      } catch (error) {
        console.error('Error finding client:', error);
        clientEmail = null;
        role = null;
      }
    }

    // Sync Client's isprofileCompleted field if profile has clientId
    if (profile.clientId) {
      await Client.findByIdAndUpdate(
        profile.clientId,
        { isprofileCompleted: profile.isProfileCompleted },
        { new: false }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      email: clientEmail,
      role: role,
      clientLogo: clientLogo || null,
      businessLogoKey: businessLogoKey || null,
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

// Get a profile by clientId (for backward compatibility)
exports.getProfileByClientId = async (req, res) => {
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

// Update a profile by profileId
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

    // Validate profileId parameter
    if (!req.params.profileId) {
      return res.status(400).json({
        success: false,
        message: 'Profile ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid profile ID format',
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

    // Prevent clientId and humanAgentId from being changed
    const updateData = { ...req.body };
    delete updateData.clientId;
    delete updateData.humanAgentId;

    // Construct address from city, state, pincode if address is not directly provided
    if (!updateData.address && (updateData.city || updateData.state || updateData.pincode)) {
      updateData.address = constructAddress(updateData);
    }

    // Find the current profile
    const profile = await Profile.findById(req.params.profileId);
    
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

    // Sync Client's isprofileCompleted field if profile has clientId
    if (profile.clientId) {
      await Client.findByIdAndUpdate(
        profile.clientId,
        { isprofileCompleted: profile.isProfileCompleted },
        { new: true }
      );
    }

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

// Delete a profile by profileId
exports.deleteProfile = async (req, res) => {
  try {
    // Validate profileId parameter
    if (!req.params.profileId) {
      return res.status(400).json({
        success: false,
        message: 'Profile ID is required',
        statusCode: 400
      });
    }

    // Validate ObjectId format
    if (!require('mongoose').Types.ObjectId.isValid(req.params.profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid profile ID format',
        statusCode: 400
      });
    }

    // First, find the profile to check if it exists
    const profile = await Profile.findById(req.params.profileId);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found',
        statusCode: 404
      });
    }

    // Store clientId before deletion for updating client status
    const clientId = profile.clientId;

    // Set isProfileCompleted to false before deletion (for audit purposes)
    profile.isProfileCompleted = false;
    await profile.save();

    // Now delete the profile
    await Profile.findByIdAndDelete(req.params.profileId);

    // Update client's profile completion status to false if profile had clientId
    if (clientId) {
      await Client.findByIdAndUpdate(
        clientId,
        { isprofileCompleted: false },
        { new: true }
      );
    }

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