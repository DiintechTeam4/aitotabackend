const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profilecontroller');
const { verifyClientToken } = require('../middlewares/authmiddleware');

//create profile
router.post('/', verifyClientToken, profileController.createProfile);

//Get current client Profile
router.get('/:clientId', verifyClientToken, profileController.getProfile);

//update profile
router.put('/:clientId', verifyClientToken, profileController.updateProfile);

//delete profile
router.delete('/:clientId', verifyClientToken, profileController.deleteProfile);

module.exports = router; 