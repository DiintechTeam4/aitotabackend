const Profile = require('../models/Profile');
const Client = require('../models/Client'); // Added to update Client

// Helper to check if all required fields are filled
function checkProfileCompleted(profile) {
  return (
    !!profile.businessName &&
    !!profile.businessType &&
    !!profile.contactNumber &&
    !!profile.contactName &&
    !!profile.address &&
    !!profile.website &&
    !!profile.pancard &&
    !!profile.gst &&
    !!profile.annualTurnover
  );
}

// Create a new profile
exports.createProfile = async (req, res) => {
  try {
    // Always set clientId from the authenticated client
    const profileData = {
      ...req.body,
      clientId: req.client._id
    };
    // Check if all fields are filled
    profileData.isProfileCompleted = checkProfileCompleted(profileData);
    const profile = new Profile(profileData);
    await profile.save();
    // Sync Client's isprofileCompleted field
    await Client.findByIdAndUpdate(
      profile.clientId,
      { isprofileCompleted: profile.isProfileCompleted },
      { new: true }
    );
    res.status(201).json({ success: true, profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get a profile by clientId
exports.getProfile = async (req, res) => {
    try {
      const profile = await Profile.findOne({ clientId: req.params.clientId });
      if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
  
      // Recalculate isProfileCompleted
      const isCompleted = checkProfileCompleted(profile);
      if (profile.isProfileCompleted !== isCompleted) {
        profile.isProfileCompleted = isCompleted;
        await profile.save(); // Optionally update in DB
      }
  
      res.json({ success: true, profile });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

// Update a profile by clientId
exports.updateProfile = async (req, res) => {
  try {
    // Prevent clientId from being changed
    const updateData = { ...req.body };
    delete updateData.clientId;
    // Fetch the current profile by clientId
    const profile = await Profile.findOne({ clientId: req.params.clientId });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    // Merge updates
    Object.assign(profile, updateData);
    // Check if all fields are filled after update
    profile.isProfileCompleted = checkProfileCompleted(profile);
    await profile.save();
    // Explicitly sync Client's isprofileCompleted field
    await Client.findByIdAndUpdate(
      profile.clientId,
      { isprofileCompleted: profile.isProfileCompleted },
      { new: true }
    );
    res.json({ success: true, profile });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete a profile by clientId
exports.deleteProfile = async (req, res) => {
  try {
    const profile = await Profile.findOneAndDelete({ clientId: req.params.clientId });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    res.json({ success: true, message: 'Profile deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}; 