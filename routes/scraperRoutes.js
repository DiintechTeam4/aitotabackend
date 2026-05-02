const express = require('express');
const router = express.Router();
const { searchLeads, saveLead } = require('../controllers/scraperController');
const { verifyClientOrAdminAndExtractClientId } = require('../middlewares/authmiddleware');

router.get('/search', verifyClientOrAdminAndExtractClientId, searchLeads);
router.post('/save', verifyClientOrAdminAndExtractClientId, saveLead);

module.exports = router;
