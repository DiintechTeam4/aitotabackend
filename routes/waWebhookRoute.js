const express = require('express');
const router = express.Router();
const wa = require('../controllers/waController');

router.get('/', wa.verifyWebhook);
router.post('/', wa.receiveWebhook);

module.exports = router;
