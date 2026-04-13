const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { verifyClientToken } = require('../middlewares/authmiddleware');
const wa = require('../controllers/waController');

// All routes require client JWT — set req.clientId from req.client
router.use(verifyClientToken);
router.use((req, res, next) => {
  if (!req.client) return res.status(401).json({ success: false, message: 'Unauthorized' });
  req.clientId = req.client._id;
  next();
});

// WhatsApp connect
router.post('/connect', wa.connectWhatsApp);
router.get('/profile', wa.getProfile);

// Contacts
router.get('/contacts', wa.listContacts);
router.post('/contacts', wa.createContact);
router.patch('/contacts/:id', wa.updateContact);
router.delete('/contacts/:id', wa.deleteContact);
router.post('/contacts/import', upload.single('file'), wa.importContacts);
router.get('/contacts/groups', wa.listGroups);
router.post('/contacts/groups', wa.createGroup);
router.delete('/contacts/groups/:id', wa.deleteGroup);

// Templates
router.get('/templates', wa.listTemplates);
router.get('/templates/:id', wa.getTemplate);
router.post('/templates', wa.createTemplate);
router.patch('/templates/:id', wa.updateTemplate);
router.delete('/templates/:id', wa.deleteTemplate);

// Campaigns
router.get('/campaigns', wa.listCampaigns);
router.get('/campaigns/:id', wa.getCampaign);
router.post('/campaigns', wa.createCampaign);
router.post('/campaigns/:id/send', wa.sendCampaign);
router.delete('/campaigns/:id', wa.deleteCampaign);

// Analytics
router.get('/analytics/overview', wa.analyticsOverview);
router.get('/analytics/campaigns', wa.analyticsCampaigns);
router.get('/analytics/timeline', wa.analyticsTimeline);

// Inbox
router.get('/inbox/conversations', wa.listConversations);
router.get('/inbox/conversations/:id/messages', wa.getMessages);
router.post('/inbox/conversations/:id/reply', wa.replyConversation);
router.patch('/inbox/conversations/:id/assign', wa.assignConversation);

// Bot flow
router.get('/bot/flow', wa.getFlow);
router.post('/bot/flow', wa.saveFlow);

module.exports = router;
