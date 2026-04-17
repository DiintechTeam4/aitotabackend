const express = require("express");
const router = express.Router();
const { loginAdmin, registerAdmin, getClients, getClientById, deleteclient, getClientToken, approveClient, getAllAgents, toggleAgentStatus, copyAgent, deleteAgent,updateClient, updateAgent, createSystemPrompt, getSystemPrompts, setDefaultSystemPrompt, deleteSystemPrompt, updateSystemPrompt, assignCzentrixToAgent } = require("../controllers/admincontroller");
const adminCtrl = require("../controllers/admincontroller");
const { verifyAdminToken } = require("../middlewares/authmiddleware");
const planController = require("../controllers/planController");
const creditController = require("../controllers/creditController");
const couponController = require("../controllers/couponController");

// Public routes
router.post("/login", loginAdmin);
router.post("/register", registerAdmin);

// Protected routes
router.get("/getclients", verifyAdminToken, getClients);
router.get(
  "/clients/:clientId/end-user-profile-fields",
  verifyAdminToken,
  adminCtrl.getClientEndUserProfileFields
);
router.put(
  "/clients/:clientId/end-user-profile-fields",
  verifyAdminToken,
  adminCtrl.updateClientEndUserProfileFields
);
router.get("/getclient/:id", verifyAdminToken, getClientById);
router.delete("/deleteclient/:id", verifyAdminToken, deleteclient);
router.get("/get-client-token/:clientId", verifyAdminToken, getClientToken);
router.post("/approve-client/:clientId", verifyAdminToken, approveClient);
router.get("/all-agents", verifyAdminToken, getAllAgents);
router.put("/toggle-agent-status/:agentId", verifyAdminToken, toggleAgentStatus);
router.post("/copy-agent", verifyAdminToken, copyAgent);
router.delete("/delete-agent/:agentId", verifyAdminToken, deleteAgent);
router.put("/update-agent/:agentId", verifyAdminToken, updateAgent);
router.put("/update-client/:clientId", verifyAdminToken, updateClient);

// System Prompts
router.post('/system-prompts', verifyAdminToken, createSystemPrompt);
router.get('/system-prompts', verifyAdminToken, getSystemPrompts);
router.put('/system-prompts/:id/default', verifyAdminToken, setDefaultSystemPrompt);
router.put('/system-prompts/:id', verifyAdminToken, updateSystemPrompt);
router.delete('/system-prompts/:id', verifyAdminToken, deleteSystemPrompt);

// Plan Management Routes
router.post('/plans', verifyAdminToken, planController.createPlan);
router.get('/plans', verifyAdminToken, planController.getAllPlans);
router.get('/plans/stats', verifyAdminToken, planController.getPlanStats);
router.get('/plans/:id', verifyAdminToken, planController.getPlanById);
router.put('/plans/:id', verifyAdminToken, planController.updatePlan);
router.delete('/plans/:id', verifyAdminToken, planController.deletePlan);
router.patch('/plans/:id/toggle', verifyAdminToken, planController.togglePlanStatus);
router.post('/plans/:id/duplicate', verifyAdminToken, planController.duplicatePlan);

// Credit Management Routes
router.get('/credits', verifyAdminToken, creditController.getAllCreditRecords);
router.get('/credits/stats', verifyAdminToken, creditController.getCreditStats);
router.get('/credits/client/:clientId', verifyAdminToken, creditController.getClientBalance);
router.get('/credits/client/:clientId/history', verifyAdminToken, creditController.getCreditHistory);
router.post('/credits/purchase', verifyAdminToken, creditController.purchasePlan);
router.post('/credits/add', verifyAdminToken, creditController.addCredits);
router.post('/credits/use', verifyAdminToken, creditController.useCredits);
router.put('/credits/client/:clientId/settings', verifyAdminToken, creditController.updateCreditSettings);
router.post('/credits/validate-coupon', verifyAdminToken, creditController.validateCoupon);

// Coupon Management Routes
router.post('/coupons', verifyAdminToken, couponController.createCoupon);
router.post('/coupons/bulk', verifyAdminToken, couponController.bulkCreateCoupons);
router.get('/coupons', verifyAdminToken, couponController.getAllCoupons);
router.get('/coupons/stats', verifyAdminToken, couponController.getCouponStats);
router.get('/coupons/:id', verifyAdminToken, couponController.getCouponById);
router.get('/coupons/:id/usage', verifyAdminToken, couponController.getCouponUsageHistory);
router.put('/coupons/:id', verifyAdminToken, couponController.updateCoupon);
router.delete('/coupons/:id', verifyAdminToken, couponController.deleteCoupon);
router.patch('/coupons/:id/toggle', verifyAdminToken, couponController.toggleCouponStatus);
router.post('/coupons/validate', verifyAdminToken, couponController.validateCouponCode);

// DID Numbers Management
router.get('/did-numbers', verifyAdminToken, adminCtrl.listDidNumbers);
router.post('/did-numbers', verifyAdminToken, adminCtrl.createDidNumber);
router.post('/did-numbers/add', verifyAdminToken, adminCtrl.addDidNumber);
router.post('/did-numbers/:did/assign', verifyAdminToken, adminCtrl.assignDidToAgent);
router.post('/did-numbers/:did/unassign', verifyAdminToken, adminCtrl.unassignDid);

// Assign C-Zentrix provider details (no DID) to agent
router.post('/assign-czentrix', verifyAdminToken, assignCzentrixToAgent);

// Campaign locks: which agents are locked due to running campaigns
router.get('/campaign-locks', verifyAdminToken, adminCtrl.getCampaignLocks);

// Import clients from external apps
router.post('/import-external-clients', verifyAdminToken, async (req, res) => {
  try {
    const Client = require('../models/Client');
    const { appSource, clients: externalClients } = req.body;
    
    if (!appSource || !['dialai', 'aivani', 'hellopaai'].includes(appSource)) {
      return res.status(400).json({
        success: false,
        message: 'Valid appSource is required (dialai, aivani, hellopaai)'
      });
    }
    
    if (!Array.isArray(externalClients) || externalClients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Clients array is required'
      });
    }
    
    const importResults = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };
    
    for (const extClient of externalClients) {
      try {
        // Check if client already exists by email or externalId
        let existingClient = null;
        
        if (extClient.externalId) {
          existingClient = await Client.findOne({
            $or: [
              { externalId: extClient.externalId, appSource },
              { email: extClient.email }
            ]
          });
        } else {
          existingClient = await Client.findOne({ email: extClient.email });
        }
        
        if (existingClient) {
          // Update existing client
          await Client.findByIdAndUpdate(existingClient._id, {
            name: extClient.name || existingClient.name,
            businessName: extClient.businessName || existingClient.businessName,
            mobileNo: extClient.mobileNo || existingClient.mobileNo,
            address: extClient.address || existingClient.address,
            city: extClient.city || existingClient.city,
            pincode: extClient.pincode || existingClient.pincode,
            websiteUrl: extClient.websiteUrl || existingClient.websiteUrl,
            appSource: existingClient.appSource || appSource,
            externalId: extClient.externalId || existingClient.externalId,
            syncedAt: new Date(),
            externalData: extClient.externalData || existingClient.externalData
          });
          importResults.updated++;
        } else {
          // Create new client
          const newClient = new Client({
            name: extClient.name,
            email: extClient.email,
            password: extClient.password || 'imported123',
            businessName: extClient.businessName || extClient.name,
            mobileNo: extClient.mobileNo || '0000000000',
            address: extClient.address || '',
            city: extClient.city || '',
            pincode: extClient.pincode || '',
            websiteUrl: extClient.websiteUrl || '',
            gstNo: extClient.gstNo || undefined,
            panNo: extClient.panNo || undefined,
            appSource,
            externalId: extClient.externalId,
            syncedAt: new Date(),
            externalData: extClient.externalData || null,
            clientType: extClient.clientType || 'new',
            isApproved: extClient.isApproved || false
          });
          
          await newClient.save();
          importResults.imported++;
        }
      } catch (error) {
        console.error(`Error importing client ${extClient.email}:`, error);
        importResults.errors.push({
          email: extClient.email,
          error: error.message
        });
        importResults.skipped++;
      }
    }
    
    res.json({
      success: true,
      message: `Import completed: ${importResults.imported} imported, ${importResults.updated} updated, ${importResults.skipped} skipped`,
      data: importResults
    });
    
  } catch (error) {
    console.error('Import external clients error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get clients by app source
router.get('/clients-by-source/:appSource', verifyAdminToken, async (req, res) => {
  try {
    const Client = require('../models/Client');
    const { appSource } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const filter = appSource === 'all' ? {} : { appSource };
    
    const clients = await Client.find(filter)
      .select('-password -waAccessToken')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();
    
    const total = await Client.countDocuments(filter);
    
    res.json({
      success: true,
      data: clients,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get clients by source error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
