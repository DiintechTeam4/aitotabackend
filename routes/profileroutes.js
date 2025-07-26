const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profilecontroller');
const { verifyClientToken, verifyAdminToken } = require('../middlewares/authmiddleware');

// Create profile for authenticated client
router.post('/', verifyClientToken, profileController.createProfile);

// Get profile by clientId (for authenticated client)
router.get('/:clientId', verifyClientToken, profileController.getProfile);

// Update profile by clientId (for authenticated client)
router.put('/:clientId', verifyClientToken, profileController.updateProfile);

// Delete profile by clientId (for authenticated client)
router.delete('/:clientId', verifyClientToken, profileController.deleteProfile);

// Get all profiles with pagination and search (for admin purposes)
router.get('/', verifyAdminToken, profileController.getAllProfiles);

module.exports = router; 