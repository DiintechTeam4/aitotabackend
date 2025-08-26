const express = require('express');
const router = express.Router();
const mongoose = require("mongoose");
const { loginClient, registerClient, getClientProfile, getAllUsers, getUploadUrl,getUploadUrlMyBusiness, googleLogin, getHumanAgents, createHumanAgent, updateHumanAgent, deleteHumanAgent, getHumanAgentById, loginHumanAgent } = require('../controllers/clientcontroller');
  const { authMiddleware, verifyAdminTokenOnlyForRegister, verifyAdminToken , verifyClientOrHumanAgentToken, verifyClientOrAdminAndExtractClientId } = require('../middlewares/authmiddleware');
const { verifyGoogleToken } = require('../middlewares/googleAuth');
const Client = require("../models/Client")
const ClientApiService = require("../services/ClientApiService")
const Agent = require('../models/Agent');
const VoiceService = require('../services/voiceService');
const voiceService = new VoiceService();
const CallLog = require('../models/CallLog');
const AgentSettings = require('../models/AgentSettings');
const Group = require('../models/Group');
const Campaign = require('../models/Campaign');
const jwt = require('jsonwebtoken');
const Business = require('../models/BusinessInfo');
const Contacts = require('../models/Contacts');
const MyBusiness = require('../models/MyBussiness');
const MyDials = require('../models/MyDials');
const User = require('../models/User'); // Added User model import
const { generateBusinessHash } = require('../utils/hashUtils');
const crypto = require('crypto');
const PaytmConfig = require('../config/paytm');
const PaytmChecksum = require('paytmchecksum');
const CashfreeConfig = require('../config/cashfree');
const {
  getClientApiKey,
  startCampaignCalling,
  stopCampaignCalling,
  getCampaignCallingProgress,
  triggerManualStatusUpdate,
  debugCallStatus,
  migrateMissedToCompleted
} = require('../services/campaignCallingService');


const clientApiService = new ClientApiService()

// Middleware to extract client ID from token or fallback to headers/query
const extractClientId = (req, res, next) => {
  try {
    console.log('extractClientId middleware called');
    if(!req.headers.authorization)
    {
      return res.status(401).json({ success: false, error: 'Authorization header is required' });
    }
    
    // First try to extract from JWT token
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      const token = req.headers.authorization.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.userType === 'client' && decoded.id) {
          req.clientId = decoded.id;
          console.log('Using clientId from token:', req.clientId);
          next();
          return;
        } else {
          return res.status(401).json({ error: 'Invalid token: userType must be client' });
        }
      } catch (tokenError) {
        console.log('Token verification failed:', tokenError.message);
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
    }
  } catch (error) {
    console.error('Error in extractClientId middleware:', error);
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

// Get or create client
router.get("/", extractClientId, async (req, res) => {
  try {
    // Fetch actual client by _id from token. Do not create here to avoid schema validation errors.
    const client = await Client.findById(req.clientId).lean();
    if (!client) {
      return res.status(404).json({ success: false, error: "Client not found" });
    }
    // Return a lightweight view with clientId added for frontend compatibility
    const responseClient = {
      ...client,
      clientId: String(client._id),
    };
    return res.json({ success: true, data: responseClient });
  } catch (error) {
    console.error("Error fetching client:", error);
    return res.status(500).json({ error: "Failed to fetch client information" });
  }
})

// Update client information
router.put("/", extractClientId, async (req, res) => {
  try {
    const { clientName, email, settings } = req.body
    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId },
      { clientName, email, settings, updatedAt: new Date() },
      { new: true, upsert: true },
    )
    res.json({ success: true, data: client, message: "Client information updated successfully" })
  } catch (error) {
    console.error("Error updating client:", error)
    res.status(500).json({ error: "Failed to update client information" })
  }
})

// Get all API keys for client
router.get("/api-keys", extractClientId, async (req, res) => {
  try {
    const result = await clientApiService.getClientApiKeys(req.clientId)
    if (result.success) {
      res.json(result)
    } else {
      res.status(500).json(result)
    }
  } catch (error) {
    console.error("Error fetching API keys:", error)
    res.status(500).json({ error: "Failed to fetch API keys" })
  }
})

// Add or update API key
router.post("/api-keys/:provider", extractClientId, async (req, res) => {
  try {
    const { provider } = req.params
    const keyData = req.body
    const result = await clientApiService.setApiKey(req.clientId, provider, keyData)
    if (result.success) {
      res.json(result)
    } else {
      res.status(400).json(result)
    }
  } catch (error) {
    console.error("Error setting API key:", error)
    res.status(500).json({ error: "Failed to set API key" })
  }
})

// Test API key
router.post("/api-keys/:provider/test", extractClientId, async (req, res) => {
  try {
    const { provider } = req.params
    const { key, configuration } = req.body
    const result = await clientApiService.testApiKey(provider, key, configuration)
    res.json(result)
  } catch (error) {
    console.error("Error testing API key:", error)
    res.status(500).json({ error: "Failed to test API key" })
  }
})

// Delete API key
router.delete("/api-keys/:provider", extractClientId, async (req, res) => {
  try {
    const { provider } = req.params
    const result = await clientApiService.deleteApiKey(req.clientId, provider)
    if (result.success) {
      res.json(result)
    } else {
      res.status(404).json(result)
    }
  } catch (error) {
    console.error("Error deleting API key:", error)
    res.status(500).json({ error: "Failed to delete API key" })
  }
})

// Get provider configurations
router.get("/providers", (req, res) => {
  try {
    const providers = clientApiService.getProviderConfigs()
    res.json({ success: true, data: providers })
  } catch (error) {
    console.error("Error fetching providers:", error)
    res.status(500).json({ error: "Failed to fetch provider configurations" })
  }
})

router.get('/upload-url',getUploadUrl);

router.get('/upload-url-mybusiness',getUploadUrlMyBusiness);

router.post('/login', loginClient);

router.post('/human-agent/login', loginHumanAgent);

router.post('/google-login',verifyGoogleToken, googleLogin);

router.post('/register',verifyAdminTokenOnlyForRegister, registerClient);

router.get('/profile', authMiddleware, getClientProfile);

// Create new agent with multiple starting messages and default selection
router.post('/agents', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    console.log('🚀 Creating agent - Request data:', {
      userType: req.user?.userType,
      clientId: req.clientId,
      adminId: req.adminId,
      bodyKeys: Object.keys(req.body)
    });
    
    const { startingMessages, defaultStartingMessageIndex, ...agentData } = req.body;
    
    // Validate required fields
    if (!agentData.agentName || !agentData.agentName.trim()) {
      return res.status(400).json({ error: 'Agent name is required.' });
    }
    if (!agentData.description || !agentData.description.trim()) {
      return res.status(400).json({ error: 'Description is required.' });
    }
    if (!agentData.systemPrompt || !agentData.systemPrompt.trim()) {
      return res.status(400).json({ error: 'System prompt is required.' });
    }
    if (!Array.isArray(startingMessages) || startingMessages.length === 0) {
      return res.status(400).json({ error: 'At least one starting message is required.' });
    }
    if (
      typeof defaultStartingMessageIndex !== 'number' ||
      defaultStartingMessageIndex < 0 ||
      defaultStartingMessageIndex >= startingMessages.length
    ) {
      return res.status(400).json({ error: 'Invalid default starting message index.' });
    }
    
    // Set default firstMessage and audioBytes
    agentData.firstMessage = startingMessages[defaultStartingMessageIndex].text;
    agentData.audioBytes = startingMessages[defaultStartingMessageIndex].audioBase64 || '';
    agentData.startingMessages = startingMessages;
    
    // Set the appropriate ID based on token type
    console.log('🔧 Setting agent IDs:', { userType: req.user.userType, clientId: req.clientId, adminId: req.adminId });
    
    if (req.user.userType === 'client') {
      // If client token, store client ID in createdBy and set clientId
      if (!req.clientId) {
        return res.status(400).json({ error: 'Client ID is required for client tokens' });
      }
      agentData.clientId = req.clientId;
      agentData.createdBy = req.clientId; // Store client ID in createdBy
      agentData.createdByType = 'client';
      console.log('✅ Client agent - IDs set:', { clientId: agentData.clientId, createdBy: agentData.createdBy, createdByType: agentData.createdByType });
    } else if (req.user.userType === 'admin') {
      // If admin token, store admin ID in createdBy and clientId is optional
      if (req.clientId) {
        agentData.clientId = req.clientId;
        console.log('✅ Admin agent with clientId:', { clientId: agentData.clientId });
      } else {
        // For admin tokens, clientId is optional - allow creating agents without client association
        agentData.clientId = undefined;
        console.log('ℹ️ Admin creating agent without clientId - agent will be unassigned');
      }
      agentData.createdBy = req.adminId; // Store admin ID in createdBy
      agentData.createdByType = 'admin';
      console.log('✅ Admin agent - IDs set:', { clientId: agentData.clientId, createdBy: agentData.createdBy, createdByType: agentData.createdByType });
    } else {
      return res.status(400).json({ error: 'Invalid user type' });
    }
    
    // Validate that createdBy is set
    if (!agentData.createdBy) {
      return res.status(400).json({ error: 'Failed to set createdBy field' });
    }

    // If creating as active with an accountSid, deactivate others first to satisfy unique index
    const willBeActive = agentData.isActive !== false; // default true per schema
    if (req.clientId && willBeActive && agentData.accountSid) {
      await Agent.updateMany(
        {
          clientId: req.clientId,
          accountSid: agentData.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
    } else if (req.user.userType === 'admin' && !req.clientId && willBeActive && agentData.accountSid) {
      // For admin-created agents without clientId, only check accountSid uniqueness
      await Agent.updateMany(
        {
          clientId: { $exists: false },
          accountSid: agentData.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
    }

    const agent = new Agent(agentData);
    const savedAgent = await agent.save();

    // If this agent is active and has accountSid, deactivate others with same (clientId, accountSid)
    if (req.clientId && savedAgent.isActive && savedAgent.accountSid) {
      await Agent.updateMany(
        {
          _id: { $ne: savedAgent._id },
          clientId: req.clientId,
          accountSid: savedAgent.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      )
    } else if (req.user.userType === 'admin' && !req.clientId && savedAgent.isActive && savedAgent.accountSid) {
      // For admin-created agents without clientId, only check accountSid uniqueness
      await Agent.updateMany(
        {
          _id: { $ne: savedAgent._id },
          clientId: { $exists: false },
          accountSid: savedAgent.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      )
    }
    
    const responseAgent = savedAgent.toObject();
    delete responseAgent.audioBytes;
    res.status(201).json(responseAgent);
  } catch (error) {
    console.error('❌ Error creating agent:', error);
    console.error('Request data:', {
      userType: req.user?.userType,
      clientId: req.clientId,
      adminId: req.adminId,
      agentData: {
        agentName: agentData.agentName,
        serviceProvider: agentData.serviceProvider,
        accountSid: agentData.accountSid
      }
    });
    
    // Provide more specific error messages
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.message,
        missingFields: Object.keys(error.errors).map(key => key)
      });
    }
    
    res.status(500).json({ error: 'Failed to create agent', details: error.message });
  }
});


// Update agent with multiple starting messages and default selection
router.put('/agents/:id', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { startingMessages, defaultStartingMessageIndex, ...agentData } = req.body;
    if (!Array.isArray(startingMessages) || startingMessages.length === 0) {
      return res.status(400).json({ error: 'At least one starting message is required.' });
    }
    if (
      typeof defaultStartingMessageIndex !== 'number' ||
      defaultStartingMessageIndex < 0 ||
      defaultStartingMessageIndex >= startingMessages.length
    ) {
      return res.status(400).json({ error: 'Invalid default starting message index.' });
    }
    // Set default firstMessage and audioBytes
    agentData.firstMessage = startingMessages[defaultStartingMessageIndex].text;
    agentData.audioBytes = startingMessages[defaultStartingMessageIndex].audioBase64 || '';
    agentData.startingMessages = startingMessages;

    // If we are activating this agent, deactivate others first to satisfy unique index
    let agent;
    if (agentData.isActive === true && req.clientId) {
      const current = await Agent.findOne({ _id: req.params.id, clientId: req.clientId });
      if (!current) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (current.accountSid) {
        await Agent.updateMany(
          {
            _id: { $ne: current._id },
            clientId: req.clientId,
            accountSid: current.accountSid,
            isActive: true,
          },
          { $set: { isActive: false, updatedAt: new Date() } }
        );
      }
    }

    agent = await Agent.findOneAndUpdate(
      req.clientId ? { _id: req.params.id, clientId: req.clientId } : { _id: req.params.id },
      agentData,
      { new: true, runValidators: true }
    );
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    // If this agent is active and has accountSid, deactivate others with same (clientId, accountSid)
    if (req.clientId && agent && agent.isActive && agent.accountSid) {
      await Agent.updateMany(
        {
          _id: { $ne: agent._id },
          clientId: req.clientId,
          accountSid: agent.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      )
    }

    const responseAgent = agent.toObject();
    delete responseAgent.audioBytes;
    res.json(responseAgent);
  } catch (error) {
    console.error('❌ Error updating agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.put('/agents/mob/:id', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const { id } = req.params;
    const { firstMessage, voiceSelection, startingMessages } = req.body;
    
    // Only allow updating firstMessage, voiceSelection, and startingMessages
    const updateData = {};
    
    if (firstMessage !== undefined) {
      updateData.firstMessage = firstMessage;
    }
    
    if (voiceSelection !== undefined) {
      updateData.voiceSelection = voiceSelection;
    }
    
    if (startingMessages !== undefined) {
      // Get the current agent to access existing startingMessages
      const currentAgent = await Agent.findOne({ _id: id, clientId: clientId });
      
      if (!currentAgent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Get existing startingMessages or initialize empty array
      const existingMessages = currentAgent.startingMessages || [];
      
      // Transform new startingMessages to proper format if they're strings
      const newMessages = startingMessages.map(msg => {
        if (typeof msg === 'string') {
          return {
            text: msg,
            audioBase64: null
          };
        }
        return msg;
      });
      
      // Combine existing and new messages
      const combinedMessages = [...existingMessages, ...newMessages];
      
      updateData.startingMessages = combinedMessages;
    }
    
    // Find and update the agent
    const agent = await Agent.findOneAndUpdate(
      { _id: id, clientId: clientId },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const responseAgent = agent.toObject();
    delete responseAgent.audioBytes; // Don't send audio bytes in response
    
    res.json(responseAgent);
  }catch(error){
    console.error('❌ Error updating agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.delete('/agents/:id', verifyClientOrAdminAndExtractClientId, async (req, res)=>{
  try{
    const { id } = req.params;
    const agent = await Agent.findOneAndDelete({ 
      _id: id, 
      clientId: req.clientId 
    });
    if(!agent)
    {
      return res.status(404).json({error:"Agent not found"});
    }
    res.json({message:"Agent deleted successfully"})
  }catch(error){
    console.error('❌ Error deleting agent:', error);
    res.status(500).json({error:"Failed to delete agent"})
  }
});

// Get all agents for client
router.get('/agents', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const filter = req.clientId ? { clientId: req.clientId } : {};
    const agents = await Agent.find(filter)
      .select('-audioBytes') // Don't send audio bytes in list view
      .sort({ createdAt: -1 });
    res.json({success: true, data: agents});
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ success: false, error: "Failed to fetch agents" });
  }
});

// Get all agents created by admin
router.get('/agents/admin', verifyAdminToken, async (req, res) => {
  try {
    const adminId = req.adminId;
    
    if (!adminId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Admin ID not found in token' 
      });
    }

    // Find all agents created by this admin
    const agents = await Agent.find({ 
      createdBy: adminId,
      createdByType: 'admin'
    })
    .select('-audioBytes') // Don't send audio bytes in list view
    .sort({ createdAt: -1 })
    .lean();

    console.log(`🔍 Admin ${adminId} fetching their agents. Found: ${agents.length}`);

    res.json({
      success: true, 
      data: agents,
      totalCount: agents.length
    });

  } catch (error) {
    console.error('❌ Error fetching admin agents:', error);
    res.status(500).json({
      success: false, 
      error: 'Failed to fetch agents',
      details: error.message
    });
  }
});

// Get agent audio
router.get('/agents/:id/audio', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const query = req.clientId ? { _id: id, clientId: req.clientId } : { _id: id };
    const agent = await Agent.findOne(query);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (!agent.audioBytes) {
      return res.status(404).json({ error: 'No audio available for this agent' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(agent.audioBytes, 'base64');
    
    // Set appropriate headers
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=3600'
    });
    
    res.send(audioBuffer);
  } catch (error) {
    console.error('Error fetching agent audio:', error);
    res.status(500).json({ error: 'Failed to fetch agent audio' });
  }
});

// Generate audio from text endpoint - returns both buffer and base64
router.post('/voice/synthesize', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { text, language = "en", speaker } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }
    const audioResult = await voiceService.textToSpeech(text, language, speaker);
    if (!audioResult.audioBuffer || !audioResult.audioBase64) {
      throw new Error("Invalid audio buffer received from voice service");
    }
    // Return both for frontend: buffer for playback, base64 for DB
    res.set({
      "Content-Type": "application/json",
    });
    res.json({
      audioBase64: audioResult.audioBase64,
      audioBuffer: audioResult.audioBuffer.toString('base64'), // for compatibility
      format: audioResult.format,
      size: audioResult.size,
      sampleRate: audioResult.sampleRate,
      channels: audioResult.channels,
      usedSpeaker: audioResult.usedSpeaker,
      targetLanguage: audioResult.targetLanguage
    });
  } catch (error) {
    console.error("❌ Voice synthesis error:", error);
    // Surface clearer error payloads to the frontend
    const message = typeof error?.message === 'string' ? error.message : String(error)
    res.status(500).json({ error: message });
  }
});

// Inbound Reports
router.get('/inbound/report', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for inbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "inbound",
      ...dateFilter 
    };
        
    const logs = await CallLog.find(query);
    const totalCalls = logs.length;
    const totalConnected = logs.filter(l => l.leadStatus !== 'not_connected').length;
    const totalNotConnected = logs.filter(l => l.leadStatus === 'not_connected').length;
    const totalConversationTime = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
    const avgCallDuration = totalCalls ? totalConversationTime / totalCalls : 0;
    
    res.json({ 
      success: true, 
      data: {
        clientId,
        totalCalls, 
        totalConnected, 
        totalNotConnected, 
        totalConversationTime, 
        avgCallDuration 
      },
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /inbound/report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Outbound Report
router.get('/outbound/report', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for outbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "outbound",
      ...dateFilter 
    };
        
    const logs = await CallLog.find(query);
    const totalCalls = logs.length;
    const totalConnected = logs.filter(l => l.leadStatus !== 'not_connected').length;
    const totalNotConnected = logs.filter(l => l.leadStatus === 'not_connected').length;
    const totalConversationTime = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
    const avgCallDuration = totalCalls ? totalConversationTime / totalCalls : 0;
    
    res.json({ 
      success: true, 
      data: {
        clientId,
        totalCalls, 
        totalConnected, 
        totalNotConnected, 
        totalConversationTime, 
        avgCallDuration 
      },
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /outbound/report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Inbound Logs/Conversation
router.get('/inbound/logs', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for inbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "inbound",
      ...dateFilter
    };
    
    // Pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const clientName = await Client.findOne({ _id: clientId }).select('name');
    
    // Get total count for pagination
    const totalCount = await CallLog.countDocuments(query);
    
    // Get paginated logs
    const logs = await CallLog.find(query)
      .sort({ createdAt: -1 })
      .populate('agentId', 'agentName')
      .skip(skip)
      .limit(limitNum)
      .lean();
      
    const logsWithAgentName = logs.map(l => ({
      ...l,
      agentName: l.agentId && l.agentId.agentName ? l.agentId.agentName : null,
    }));
    
    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;
    
    res.json({
      success: true, 
      clientName: clientName,
      data: logsWithAgentName,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limitNum,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      }
    });
  } catch (error) {
    console.error('Error in /inbound/logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Outbound logs API
router.get('/outbound/logs', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for outbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "outbound",
      ...dateFilter
    };
    
    // Pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const clientName = await Client.findOne({ _id: clientId }).select('name');
    
    // Get total count for pagination
    const totalCount = await CallLog.countDocuments(query);
    
    // Get paginated logs
    const logs = await CallLog.find(query)
      .sort({ createdAt: -1 })
      .populate('agentId', 'agentName')
      .skip(skip)
      .limit(limitNum)
      .lean();
      
    const logsWithAgentName = logs.map(l => ({
      ...l,
      agentName: l.agentId && l.agentId.agentName ? l.agentId.agentName : null,
    }));
    
    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;
    
    res.json({
      success: true, 
      clientName: clientName,
      data: logsWithAgentName,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limitNum,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      }
    });
  } catch (error) {
    console.error('Error in /outbound/logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Inbound Leads
router.get('/inbound/leads', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }

    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for inbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "inbound",
      ...dateFilter 
    };    
    const logs = await CallLog.find(query).sort({ createdAt: -1 });
    
    // Group leads according to the new leadStatus structure
    const leads = {
      // Connected - Interested
      veryInterested: {
        data: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'very_interested'),
        count: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'very_interested').length
      },
      maybe: {
        data: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium'),
        count: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium').length
      },
      enrolled: {
        data: logs.filter(l => l.leadStatus === 'enrolled'),
        count: logs.filter(l => l.leadStatus === 'enrolled').length
      },
      
      // Connected - Not Interested
      junkLead: {
        data: logs.filter(l => l.leadStatus === 'junk_lead'),
        count: logs.filter(l => l.leadStatus === 'junk_lead').length
      },
      notRequired: {
        data: logs.filter(l => l.leadStatus === 'not_required'),
        count: logs.filter(l => l.leadStatus === 'not_required').length
      },
      enrolledOther: {
        data: logs.filter(l => l.leadStatus === 'enrolled_other'),
        count: logs.filter(l => l.leadStatus === 'enrolled_other').length
      },
      decline: {
        data: logs.filter(l => l.leadStatus === 'decline'),
        count: logs.filter(l => l.leadStatus === 'decline').length
      },
      notEligible: {
        data: logs.filter(l => l.leadStatus === 'not_eligible'),
        count: logs.filter(l => l.leadStatus === 'not_eligible').length
      },
      wrongNumber: {
        data: logs.filter(l => l.leadStatus === 'wrong_number'),
        count: logs.filter(l => l.leadStatus === 'wrong_number').length
      },
      
      // Connected - Followup
      hotFollowup: {
        data: logs.filter(l => l.leadStatus === 'hot_followup'),
        count: logs.filter(l => l.leadStatus === 'hot_followup').length
      },
      coldFollowup: {
        data: logs.filter(l => l.leadStatus === 'cold_followup'),
        count: logs.filter(l => l.leadStatus === 'cold_followup').length
      },
      schedule: {
        data: logs.filter(l => l.leadStatus === 'schedule'),
        count: logs.filter(l => l.leadStatus === 'schedule').length
      },
      
      // Not Connected
      notConnected: {
        data: logs.filter(l => l.leadStatus === 'not_connected'),
        count: logs.filter(l => l.leadStatus === 'not_connected').length
      }
    };

    res.json({ 
      success: true, 
      data: leads,
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /inbound/leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Outbound Leads
router.get('/outbound/leads', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }

    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query - filter for outbound calls only
    const query = { 
      clientId, 
      'metadata.callDirection': "outbound",
      ...dateFilter 
    };    
    const logs = await CallLog.find(query).sort({ createdAt: -1 });
    
    // Group leads according to the new leadStatus structure
    const leads = {
      // Connected - Interested
      veryInterested: {
        data: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'very_interested'),
        count: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'very_interested').length
      },
      maybe: {
        data: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium'),
        count: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium').length
      },
      enrolled: {
        data: logs.filter(l => l.leadStatus === 'enrolled'),
        count: logs.filter(l => l.leadStatus === 'enrolled').length
      },
      
      // Connected - Not Interested
      junkLead: {
        data: logs.filter(l => l.leadStatus === 'junk_lead'),
        count: logs.filter(l => l.leadStatus === 'junk_lead').length
      },
      notRequired: {
        data: logs.filter(l => l.leadStatus === 'not_required'),
        count: logs.filter(l => l.leadStatus === 'not_required').length
      },
      enrolledOther: {
        data: logs.filter(l => l.leadStatus === 'enrolled_other'),
        count: logs.filter(l => l.leadStatus === 'enrolled_other').length
      },
      decline: {
        data: logs.filter(l => l.leadStatus === 'decline'),
        count: logs.filter(l => l.leadStatus === 'decline').length
      },
      notEligible: {
        data: logs.filter(l => l.leadStatus === 'not_eligible'),
        count: logs.filter(l => l.leadStatus === 'not_eligible').length
      },
      wrongNumber: {
        data: logs.filter(l => l.leadStatus === 'wrong_number'),
        count: logs.filter(l => l.leadStatus === 'wrong_number').length
      },
      
      // Connected - Followup
      hotFollowup: {
        data: logs.filter(l => l.leadStatus === 'hot_followup'),
        count: logs.filter(l => l.leadStatus === 'hot_followup').length
      },
      coldFollowup: {
        data: logs.filter(l => l.leadStatus === 'cold_followup'),
        count: logs.filter(l => l.leadStatus === 'cold_followup').length
      },
      schedule: {
        data: logs.filter(l => l.leadStatus === 'schedule'),
        count: logs.filter(l => l.leadStatus === 'schedule').length
      },
      
      // Not Connected
      notConnected: {
        data: logs.filter(l => l.leadStatus === 'not_connected'),
        count: logs.filter(l => l.leadStatus === 'not_connected').length
      }
    };

    res.json({ 
      success: true, 
      data: leads,
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /outbound/leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Inbound Settings (GET/PUT)
router.get('/inbound/settings', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const settings = await AgentSettings.findOne({ clientId });
    res.json(settings);
  } catch (error) {
    console.error('Error in /inbound/settings GET:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

//Inbound Settings
router.put('/inbound/settings', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const update = req.body;
    const settings = await AgentSettings.findOneAndUpdate({ clientId }, update, { new: true, upsert: true });
    res.json(settings);
  } catch (error) {
    console.error('Error in /inbound/settings PUT:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});
// ==================== Sync Contacts =================

// Bulk contact addition
router.post('/sync/contacts', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ 
        status: false, 
        message: 'contacts array is required and must not be empty' 
      });
    }

    // Validate each contact
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact.name || !contact.name.trim() || !contact.phone || !contact.phone.trim()) {
        return res.status(400).json({ 
          status: false, 
          message: `Contact at index ${i}: name and phone are required` 
        });
      }
    }

    const results = {
      success: [],
      duplicates: [],
      errors: []
    };

    // Process each contact
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      try {
        // Clean phone number: remove spaces and country code
        let cleanPhone = contact.phone.trim().replace(/\s+/g, ''); // Remove all spaces
        let countryCode = ''; // Default empty country code
        
        // Remove common country codes if present and save the country code
        const countryCodes = ['+91', '+1', '+44', '+61', '+86', '+81', '+49', '+33', '+39', '+34', '+7', '+55', '+52', '+31', '+46', '+47', '+45', '+358', '+46', '+47', '+45', '+358'];
        for (const code of countryCodes) {
          if (cleanPhone.startsWith(code)) {
            countryCode = code; // Save the country code
            cleanPhone = cleanPhone.substring(code.length);
            break;
          }
        }
        
        // Handle US numbers without + prefix (like 964-339-5853)
        // If phone number is 10 digits and starts with common US area codes, assume it's US
        if (!countryCode && cleanPhone.length === 10 && /^[2-9]\d{9}$/.test(cleanPhone)) {
          countryCode = '+1';
        }
        
        // Handle 11-digit US numbers starting with 1
        if (!countryCode && cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
          countryCode = '+1';
          cleanPhone = cleanPhone.substring(1);
        }
        
        // If phone starts with 0, remove it (common in many countries)
        if (cleanPhone.startsWith('0')) {
          cleanPhone = cleanPhone.substring(1);
        }
        
        // Check if contact already exists with cleaned phone
        const existingContact = await Contacts.findOne({ 
          clientId, 
          phone: cleanPhone 
        });

        if (existingContact) {
          results.duplicates.push({
            index: i,
            input: contact,
            existing: {
              name: existingContact.name,
              phone: existingContact.phone
            }
          });
          continue;
        }

        // Create new contact with cleaned phone and country code
        const newContact = new Contacts({
          name: contact.name.trim(),
          phone: cleanPhone,
          countyCode: countryCode, // Save the country code
          email: contact.email?.trim() || '',
          clientId
        });

        const savedContact = await newContact.save();
        results.success.push({
          index: i,
          data: savedContact
        });

      } catch (error) {
        results.errors.push({
          index: i,
          input: contact,
          error: error.message
        });
      }
    }

    // Determine response status
    const hasSuccess = results.success.length > 0;
    const hasDuplicates = results.duplicates.length > 0;
    const hasErrors = results.errors.length > 0;

    let statusCode = 200;
    let message = '';

    if (hasSuccess && !hasDuplicates && !hasErrors) {
      statusCode = 201;
      message = `Successfully added ${results.success.length} contacts`;
    } else if (hasSuccess && (hasDuplicates || hasErrors)) {
      statusCode = 207; // Multi-Status
      message = `Partially successful: ${results.success.length} added, ${results.duplicates.length} duplicates, ${results.errors.length} errors`;
    } else if (!hasSuccess && hasDuplicates) {
      statusCode = 409;
      message = `All contacts already exist (${results.duplicates.length} duplicates)`;
    } else if (!hasSuccess && hasErrors) {
      statusCode = 400;
      message = `Failed to add contacts: ${results.errors.length} errors`;
    }

    res.status(statusCode).json({
      status: hasSuccess,
      message,
      results
    });

  } catch (error) {
    console.error('Error in bulk contact addition:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Internal server error during bulk contact addition' 
    });
  }
});

// ==================== GROUPS API ====================

// Get all groups for client
router.get('/groups', extractClientId, async (req, res) => {
  try {
    const groups = await Group.find({ clientId: req.clientId }).sort({ createdAt: -1 });
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Create new group
router.post('/groups', extractClientId, async (req, res) => {
  try {
    const { name, category, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Check for duplicate group name within the same client
    const groupNameMatch = await Group.findOne({
      name: { $regex: name.trim(), $options: 'i' },
      clientId: req.clientId
    });
    if (groupNameMatch) {
      return res.status(400).json({ success : false,error: 'Group name already exists' });
    }

    const group = new Group({
      name: name.trim(),
      category: category?.trim() || '',
      description: description?.trim() || '',
      clientId: req.clientId,
      contacts: []
    });

    await group.save();
    res.status(201).json({ success: true, data: group });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get single group by ID
router.get('/groups/:id', extractClientId, async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true, data: group });
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Update group
router.put('/groups/:id', extractClientId, async (req, res) => {
  try {
    const { name, category, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Check for duplicate group name within the same client (excluding current group)
    const groupNameMatch = await Group.findOne({
      name: { $regex: name.trim(), $options: 'i' },
      clientId: req.clientId,
      _id: { $ne: req.params.id }
    });
    if (groupNameMatch) {
      return res.status(400).json({ success : false, error: 'Group name already exists' });
    }

    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { 
        name: name.trim(), 
        category: category?.trim() || '',
        description: description?.trim() || '',
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, data: group });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete group
router.delete('/groups/:id', extractClientId, async (req, res) => {
  try {
    const group = await Group.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Add contact to group
router.post('/groups/:id/contacts', extractClientId, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    
    if (!phone || !phone.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'phone is required' 
      });
    }

    // Function to normalize phone number for duplicate detection
    const normalizePhoneNumber = (phoneNumber) => {
      if (!phoneNumber) return '';
      
      // Convert to string and trim
      let normalized = phoneNumber.toString().trim();
      
      // Remove all spaces, dashes, dots, and parentheses
      normalized = normalized.replace(/[\s\-\.\(\)]/g, '');
      
      // Remove country codes (common patterns)
      // Remove +91, +1, +44, etc. (any + followed by 1-3 digits)
      normalized = normalized.replace(/^\+\d{1,3}/, '');
      
      // Remove leading zeros
      normalized = normalized.replace(/^0+/, '');
      
      // If the number starts with 91 and is longer than 10 digits, remove 91
      if (normalized.startsWith('91') && normalized.length > 10) {
        normalized = normalized.substring(2);
      }
      
      // If the number starts with 1 and is longer than 10 digits, remove 1
      if (normalized.startsWith('1') && normalized.length > 10) {
        normalized = normalized.substring(1);
      }
      
      return normalized;
    };

    const group = await Group.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ 
        success: false,
        error: 'Group not found' 
      });
    }

    // Normalize the input phone number
    const normalizedInputPhone = normalizePhoneNumber(phone);
    
    // Check if normalized phone number already exists in the group
    const existingContact = group.contacts.find(contact => {
      const normalizedContactPhone = normalizePhoneNumber(contact.phone);
      return normalizedContactPhone === normalizedInputPhone;
    });
    
    if (existingContact) {
      return res.status(409).json({ 
        success: false,
        error: 'Phone number already exists in this group',
        existingContact: {
          name: existingContact.name,
          phone: existingContact.phone,
          email: existingContact.email || '',
          createdAt: existingContact.createdAt
        },
        message: `Phone number ${phone.trim()} is already assigned to contact "${existingContact.name}" in group "${group.name}" (normalized: ${normalizedInputPhone})`
      });
    }

    const contact = {
      name: typeof name === 'string' ? name.trim() : '',
      phone: phone.trim(),
      normalizedPhone: normalizedInputPhone, // Store normalized version for future comparisons
      email: typeof email === 'string' ? email.trim() : '',
      createdAt: new Date()
    };

    group.contacts.push(contact);
    await group.save();

    res.status(201).json({ 
      success: true, 
      data: contact,
      message: 'Contact added successfully to group'
    });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to add contact' 
    });
  }
});

// Delete contact from group
router.delete('/groups/:groupId/contacts/:contactId', extractClientId, async (req, res) => {
  try {
    const { groupId, contactId } = req.params;
    
    const group = await Group.findOne({ _id: groupId, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    group.contacts = group.contacts.filter(contact => contact._id.toString() !== contactId);
    await group.save();

    res.json({ success: true, message: 'Contact deleted successfully' });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ==================== CAMPAIGNS API ====================

// Get all campaigns for client
router.get('/campaigns', extractClientId, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ clientId: req.clientId })
      .populate('groupIds', 'name description')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Create new campaign
router.post('/campaigns', extractClientId, async (req, res) => {
  try {
    const { name, description, groupIds, category, agent, isRunning } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    // Check for duplicate campaign name within the same client
    const campaignNameMatch = await Campaign.findOne({
      name: { $regex: name.trim(), $options: 'i' },
      clientId: req.clientId
    });
    if (campaignNameMatch) {
      return res.status(400).json({ error: 'Campaign name already exists' });
    }

    let agentArray = [];
    if (Array.isArray(agent)) {
      agentArray = agent
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (typeof agent === 'string') {
      const val = agent.trim();
      agentArray = val ? [val] : [];
    }

    const campaign = new Campaign({
      name: name.trim(),
      description: description?.trim() || '',
      groupIds: groupIds || [],
      clientId: req.clientId,
      category: category?.trim() || '',
      agent: agentArray,
      isRunning: isRunning || false
    });

    await campaign.save();
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Get single campaign by ID
router.get('/campaigns/:id', extractClientId, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, clientId: req.clientId })
      .populate('groupIds', 'name description contacts');
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Update campaign
router.put('/campaigns/:id', extractClientId, async (req, res) => {
  try {
    const { name, description, groupIds, category, agent, isRunning } = req.body;

    // Check for duplicate campaign name within the same client (excluding current campaign)
    if (name && name.trim()) {
      const campaignNameMatch = await Campaign.findOne({
        name: { $regex: name.trim(), $options: 'i' },
        clientId: req.clientId,
        _id: { $ne: req.params.id }
      });
      if (campaignNameMatch) {
        return res.status(400).json({ error: 'Campaign name already exists' });
      }
    }

    const updateData = {
      updatedAt: new Date()
    };

    if (name !== undefined && name.trim()) {
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || '';
    }

    if (groupIds !== undefined) {
      updateData.groupIds = groupIds;
    }

    if (category !== undefined) {
      updateData.category = category?.trim() || '';
    }

    if (agent !== undefined) {
      if (Array.isArray(agent)) {
        updateData.agent = agent
          .filter((v) => typeof v === 'string')
          .map((v) => v.trim())
          .filter(Boolean);
      } else if (typeof agent === 'string') {
        const val = agent.trim();
        updateData.agent = val ? [val] : [];
      } else {
        updateData.agent = [];
      }
    }

    if (isRunning !== undefined) {
      updateData.isRunning = isRunning;
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      updateData,
      { new: true }
    ).populate('groupIds', 'name description');

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Delete campaign
router.delete('/campaigns/:id', extractClientId, async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Add groups to campaign
router.post('/campaigns/:id/groups', extractClientId, async (req, res) => {
  try {
    const { groupIds } = req.body;
    
    if (!groupIds || !Array.isArray(groupIds)) {
      return res.status(400).json({ error: 'groupIds array is required' });
    }

    const campaign = await Campaign.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Verify all groups belong to the client
    const groups = await Group.find({ _id: { $in: groupIds }, clientId: req.clientId });
    if (groups.length !== groupIds.length) {
      return res.status(400).json({ error: 'Some groups not found or don\'t belong to client' });
    }

    campaign.groupIds = groupIds;
    await campaign.save();

    const updatedCampaign = await Campaign.findById(campaign._id)
      .populate('groupIds', 'name description');

    res.json({ success: true, data: updatedCampaign });
  } catch (error) {
    console.error('Error adding groups to campaign:', error);
    res.status(500).json({ error: 'Failed to add groups to campaign' });
  }
});

//Delete group from campaign
router.delete('/campaigns/:id/groups/:groupId', extractClientId, async (req, res) => {
  try {
    const { id, groupId } = req.params;
    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    campaign.groupIds = campaign.groupIds.filter((id) => id.toString() !== groupId);
    await campaign.save();
    res.json({ success: true, message: 'Group deleted from campaign' });
  }catch (error) {
    console.error('Error deleting group from campaign:', error);
    res.status(500).json({ error: 'Failed to delete group from campaign' });
  }
})

// Get all groups associated with a campaign
router.get('/campaigns/:id/groups', extractClientId, async (req, res) => {
  try {
    // Find the campaign and verify it belongs to the client
    const campaign = await Campaign.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // If no groups are associated with the campaign
    if (!campaign.groupIds || campaign.groupIds.length === 0) {
      return res.json({ success: true, data: [], message: 'No groups associated with this campaign' });
    }

    // Fetch all groups associated with the campaign
    const groups = await Group.find({ 
      _id: { $in: campaign.groupIds }, 
      clientId: req.clientId 
    }).populate('contacts', 'name email phone');

    res.json({ 
      success: true, 
      campaignName: campaign.name,
      totalGroups: groups.length,
      data: groups,
      campaignId: campaign._id,
    });
  } catch (error) {
    console.error('Error fetching campaign groups:', error);
    res.status(500).json({ error: 'Failed to fetch campaign groups' });
  }
});

// Add unique ID to campaign (for tracking campaign calls)
router.post('/campaigns/:id/unique-ids', extractClientId, async (req, res) => {
  try {
    const { uniqueId } = req.body;
    
    if (!uniqueId || typeof uniqueId !== 'string') {
      return res.status(400).json({ error: 'uniqueId is required and must be a string' });
    }

    const campaign = await Campaign.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Add unique ID to campaign details if it doesn't already exist
    const existingDetail = Array.isArray(campaign.details) && 
      campaign.details.find(detail => detail.uniqueId === uniqueId);
    
    if (!existingDetail) {
      const callDetail = {
        uniqueId: uniqueId,
        contactId: req.body.contactId || null,
        time: new Date(),
        status: 'ringing', // Start with 'ringing' status
        lastStatusUpdate: new Date(),
        callDuration: 0
      };
      
      if (!Array.isArray(campaign.details)) {
        campaign.details = [];
      }
      
      campaign.details.push(callDetail);
      await campaign.save();
      console.log(`✅ Added unique ID ${uniqueId} to campaign ${campaign._id} with contactId: ${req.body.contactId || 'null'}`);
    }

    res.json({ 
      success: true, 
      message: 'Unique ID added to campaign',
      data: { 
        uniqueId, 
        totalDetails: Array.isArray(campaign.details) ? campaign.details.length : 0 
      }
    });
  } catch (error) {
    console.error('Error adding unique ID to campaign:', error);
    res.status(500).json({ error: 'Failed to add unique ID to campaign' });
  }
});

// Get call logs for a campaign using stored uniqueIds
// router.get('/campaigns/:id/call-logs', extractClientId, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const page = parseInt(req.query.page || '1', 10);
//     const limit = parseInt(req.query.limit || '50', 10);
//     const sortBy = req.query.sortBy || 'createdAt';
//     const sortOrder = (req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

//     const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
//     if (!campaign) {
//       return res.status(404).json({ success: false, error: 'Campaign not found' });
//     }

//     // If a specific documentId is provided, return only its logs (convenience path)
//     const documentId = req.query.documentId;
//     if (documentId) {
//       if (!Array.isArray(campaign.uniqueIds) || !campaign.uniqueIds.includes(documentId)) {
//         return res.status(404).json({ success: false, error: 'Document ID not found in this campaign' });
//       }

//       const logsByDoc = await CallLog.find({
//         clientId: req.clientId,
//         campaignId: campaign._id,
//         'metadata.customParams.uniqueid': documentId
//       })
//         .sort({ createdAt: sortOrder })
//         .populate('campaignId', 'name description')
//         .populate('agentId', 'agentName')
//         .lean();

//       return res.json({
//         success: true,
//         data: logsByDoc,
//         campaign: { _id: campaign._id, name: campaign.name },
//         documentId
//       });
//     }

//     const uniqueIds = Array.isArray(campaign.uniqueIds) ? campaign.uniqueIds.filter(Boolean) : [];
//     if (uniqueIds.length === 0) {
//       return res.json({
//         success: true,
//         data: [],
//         campaign: { _id: campaign._id, name: campaign.name, uniqueIdsCount: 0 },
//         pagination: { currentPage: page, totalPages: 0, totalLogs: 0, hasNextPage: false, hasPrevPage: false }
//       });
//     }

//     const query = {
//       clientId: req.clientId,
//       'metadata.customParams.uniqueid': { $in: uniqueIds }
//     };

//     const totalLogs = await CallLog.countDocuments(query);
//     const skip = (page - 1) * limit;
//     const sortSpec = { [sortBy]: sortOrder };

//     const logs = await CallLog.find(query)
//       .sort(sortSpec)
//       .skip(skip)
//       .limit(limit)
//       .populate('campaignId', 'name description')
//       .populate('agentId', 'agentName')
//       .lean();

//     // Build placeholders for uniqueIds without logs
//     const loggedUniqueIds = new Set(
//       (logs || [])
//         .map(l => l && l.metadata && l.metadata.customParams && l.metadata.customParams.uniqueid)
//         .filter(Boolean)
//     );
//     const missingUniqueIds = uniqueIds.filter(uid => !loggedUniqueIds.has(uid));

//     const placeholderLogs = missingUniqueIds.map(uid => ({
//       _id: new mongoose.Types.ObjectId(),
//       clientId: req.clientId,
//       campaignId: { _id: campaign._id, name: campaign.name },
//       agentId: null,
//       mobile: null,
//       duration: 0,
//       callType: 'outbound',
//       leadStatus: 'not_connected',
//       statusText: 'Not Accepted / Busy / Disconnected',
//       createdAt: null,
//       time: null,
//       metadata: { customParams: { uniqueid: uid }, isActive: false }
//     }));

//     const allLogs = [...logs, ...placeholderLogs];

//     return res.json({
//       success: true,
//       data: allLogs,
//       campaign: {
//         _id: campaign._id,
//         name: campaign.name,
//         uniqueIdsCount: uniqueIds.length,
//         missingUniqueIdsCount: missingUniqueIds.length
//       },
//       pagination: {
//         currentPage: page,
//         totalPages: Math.ceil(totalLogs / limit),
//         totalLogs,
//         hasNextPage: skip + logs.length < totalLogs,
//         hasPrevPage: page > 1
//       }
//     });
//   } catch (error) {
//     console.error('Error fetching campaign call logs:', error);
//     return res.status(500).json({ success: false, error: 'Failed to fetch campaign call logs' });
//   }
// });

// GET campaign contacts
router.get('/campaigns/:id/contacts', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    res.json({
      success: true,
      data: campaign.contacts || []
    });
  } catch (error) {
    console.error('Error fetching campaign contacts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch campaign contacts' });
  }
});

// POST new contact to campaign
router.post('/campaigns/:id/contacts', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone are required' });
    }

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Check if phone number already exists in campaign contacts
    const existingContact = campaign.contacts.find(contact => contact.phone === phone);
    if (existingContact) {
      return res.status(400).json({ success: false, error: 'Phone number already exists in this campaign' });
    }

    // Add new contact (MongoDB will auto-generate _id)
    campaign.contacts.push({
      _id: new mongoose.Types.ObjectId(),
      name,
      phone,
      email: email || '',
      addedAt: new Date()
    });

    await campaign.save();

    res.json({
      success: true,
      data: campaign.contacts[campaign.contacts.length - 1],
      message: 'Contact added successfully'
    });
  } catch (error) {
    console.error('Error adding contact to campaign:', error);
    res.status(500).json({ success: false, error: 'Failed to add contact to campaign' });
  }
});

// DELETE campaign contact
router.delete('/campaigns/:id/contacts/:contactId', extractClientId, async (req, res) => {
  try {
    const { id, contactId } = req.params;
    
    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Remove the contact using ObjectId
    const initialLength = campaign.contacts.length;
    campaign.contacts = campaign.contacts.filter(contact => 
      contact._id.toString() !== contactId
    );
    
    if (campaign.contacts.length === initialLength) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    await campaign.save();

    res.json({
      success: true,
      message: 'Contact removed successfully'
    });
  } catch (error) {
    console.error('Error removing campaign contact:', error);
    res.status(500).json({ success: false, error: 'Failed to remove campaign contact' });
  }
});

// POST sync contacts from groups
router.post('/campaigns/:id/sync-contacts', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    
    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (!campaign.groupIds || campaign.groupIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No groups in campaign to sync from' });
    }

    // Local helper: normalize phone numbers for consistent comparison
    const normalizePhoneNumber = (phoneNumber) => {
      if (!phoneNumber) return '';
      let normalized = phoneNumber.toString().trim();
      normalized = normalized.replace(/[\s\-\.\(\)]/g, '');
      normalized = normalized.replace(/^\+\d{1,3}/, '');
      normalized = normalized.replace(/^0+/, '');
      if (normalized.startsWith('91') && normalized.length > 10) {
        normalized = normalized.substring(2);
      }
      if (normalized.startsWith('1') && normalized.length > 10) {
        normalized = normalized.substring(1);
      }
      return normalized;
    };

    // Fetch all groups and their contacts
    const groups = await Group.find({ _id: { $in: campaign.groupIds } });
    
    let totalContacts = 0;
    let totalGroups = groups.length;
    const newContacts = [];
    const contactsToRemove = [];

    // Collect all valid (normalized) phone numbers from groups
    const validPhoneNumbers = new Set();
    
    for (const group of groups) {
      if (group.contacts && group.contacts.length > 0) {
        for (const groupContact of group.contacts) {
          const normalizedGroupPhone = normalizePhoneNumber(groupContact.phone);
          validPhoneNumbers.add(normalizedGroupPhone);
          
          // Check if phone number already exists in campaign contacts (normalized compare)
          const existingContact = campaign.contacts.find(contact => {
            const normalizedExisting = normalizePhoneNumber(contact.phone);
            return normalizedExisting === normalizedGroupPhone;
          });
          if (!existingContact) {
            newContacts.push({
              _id: new mongoose.Types.ObjectId(),
              name: groupContact.name,
              phone: groupContact.phone,
              email: groupContact.email || '',
              addedAt: new Date()
            });
            totalContacts++;
          }
        }
      }
    }

    // Find contacts to remove (contacts that are no longer in any group)
    for (const campaignContact of campaign.contacts) {
      const normalizedCampaignPhone = normalizePhoneNumber(campaignContact.phone);
      if (!validPhoneNumbers.has(normalizedCampaignPhone)) {
        contactsToRemove.push(campaignContact);
      }
    }

    // Remove contacts that are no longer in groups
    if (contactsToRemove.length > 0) {
      campaign.contacts = campaign.contacts.filter(contact => 
        !contactsToRemove.some(removedContact => removedContact.phone === contact.phone)
      );
    }

    // Add new contacts to campaign
    if (newContacts.length > 0) {
      campaign.contacts.push(...newContacts);
    }

    // Save campaign if there were any changes
    if (newContacts.length > 0 || contactsToRemove.length > 0) {
      await campaign.save();
    }

    res.json({
      success: true,
      data: {
        totalContacts: totalContacts,
        totalGroups: totalGroups,
        newContactsAdded: newContacts.length,
        contactsRemoved: contactsToRemove.length,
        totalContactsInCampaign: campaign.contacts.length
      },
      message: `Synced ${newContacts.length} new contacts and removed ${contactsToRemove.length} contacts from ${totalGroups} groups`
    });
  } catch (error) {
    console.error('Error syncing contacts from groups:', error);
    res.status(500).json({ success: false, error: 'Failed to sync contacts from groups' });
  }
});

// Get minimal leads list for a campaign: documentId, number, name, leadStatus
router.get('/campaigns/:id/leads', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Use the new details structure instead of uniqueIds
    const details = Array.isArray(campaign.details) ? campaign.details.filter(Boolean) : [];
    const totalItems = details.length;

    if (totalItems === 0) {
      return res.json({
        success: true,
        data: [],
        campaign: { _id: campaign._id, name: campaign.name, detailsCount: 0 },
        pagination: { currentPage: page, totalPages: 0, totalItems: 0, hasNextPage: false, hasPrevPage: false }
      });
    }

    const skip = (page - 1) * limit;
    const pagedDetails = details.slice(skip, skip + limit);

    // Extract uniqueIds from the paged details
    const pagedUniqueIds = pagedDetails.map(detail => detail.uniqueId);

    // Fetch logs for the paged uniqueIds and map latest log per id
    const logs = await CallLog.find({
      clientId: req.clientId,
      'metadata.customParams.uniqueid': { $in: pagedUniqueIds }
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestLogByUid = new Map();
    for (const log of logs) {
      const uid = log && log.metadata && log.metadata.customParams && log.metadata.customParams.uniqueid;
      if (uid && !latestLogByUid.has(uid)) {
        latestLogByUid.set(uid, log);
      }
    }

    const minimal = pagedDetails.map(detail => {
      const log = latestLogByUid.get(detail.uniqueId);
      const name = log && (log.contactName || (log.metadata && log.metadata.customParams && log.metadata.customParams.name));
      const number = log && (log.mobile || (log.metadata && log.metadata.callerId));
      const leadStatus = (log && log.leadStatus) || 'not_connected';
      return {
        documentId: detail.uniqueId,
        number: number || null,
        name: name || null,
        leadStatus,
        contactId: detail.contactId,
        time: detail.time,
        status: detail.status
      };
    });

    return res.json({
      success: true,
      data: minimal,
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        detailsCount: totalItems
      },
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        hasNextPage: skip + pagedUniqueIds.length < totalItems,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching minimal leads list:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch minimal leads list' });
  }
});

// by-document via query on the original call-logs path; returns only transcript
router.get('/campaigns/:id/logs/:documentId', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({ success: false, error: 'documentId query parameter is required' });
    }

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Check if documentId exists in campaign details
    const detailExists = Array.isArray(campaign.details) && 
      campaign.details.some(detail => detail.uniqueId === documentId);
    
    if (!detailExists) {
      return res.status(404).json({ success: false, error: 'Document ID not found in this campaign' });
    }

    // Relaxed filter: match by clientId and uniqueid only, to avoid campaignId mismatches
    const latest = await CallLog.findOne({
      clientId: req.clientId,
      'metadata.customParams.uniqueid': documentId,
      transcript: { $ne: '' }
    })
      .sort({ createdAt: -1 })
      .select('transcript createdAt')
      .lean();

    return res.json({
      success: true,
      transcript: latest ? latest.transcript : '',
      documentId
    });
  } catch (error) {
    console.error('Error fetching transcript by documentId (alias route):', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch transcript' });
  }
});

// Start campaign calling process
router.post('/campaigns/:id/start-calling', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId, delayBetweenCalls = 2000 } = req.body;

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (!campaign.contacts || campaign.contacts.length === 0) {
      return res.status(400).json({ success: false, error: 'No contacts in campaign to call' });
    }

    // Check if campaign is already running
    if (campaign.isRunning) {
      return res.status(400).json({ success: false, error: 'Campaign is already running' });
    }

    // Resolve API key from Agent instead of Client
    const agent = await Agent.findById(agentId).lean();
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    const apiKey = agent.X_API_KEY || '';
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'No API key found on agent' });
    }

    // Update campaign status
    campaign.isRunning = true;
    await campaign.save();

    // Start calling process in background
    startCampaignCalling(campaign, agentId, apiKey, delayBetweenCalls, req.clientId);

    res.json({
      success: true,
      message: 'Campaign calling started',
      data: {
        campaignId: campaign._id,
        totalContacts: campaign.contacts.length,
        status: 'started'
      }
    });

  } catch (error) {
    console.error('Error starting campaign calling:', error);
    res.status(500).json({ success: false, error: 'Failed to start campaign calling' });
  }
});

// Stop campaign calling process
router.post('/campaigns/:id/stop-calling', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Update campaign status
    campaign.isRunning = false;
    await campaign.save();

    // Stop the calling process
    stopCampaignCalling(campaign._id.toString());

    res.json({
      success: true,
      message: 'Campaign calling stopped',
      data: {
        campaignId: campaign._id,
        status: 'stopped'
      }
    });

  } catch (error) {
    console.error('Error stopping campaign calling:', error);
    res.status(500).json({ success: false, error: 'Failed to stop campaign calling' });
  }
});

// Get campaign calling status
router.get('/campaigns/:id/calling-status', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Get calling progress from memory
    const callingProgress = getCampaignCallingProgress(campaign._id.toString());

    res.json({
      success: true,
      data: {
        campaignId: campaign._id,
        isRunning: campaign.isRunning,
        totalContacts: campaign.contacts.length,
        progress: callingProgress
      }
    });

  } catch (error) {
    console.error('Error getting campaign calling status:', error);
    res.status(500).json({ success: false, error: 'Failed to get campaign calling status' });
  }
});

// ==================== BUSINESS INFO API ====================
//create client business id
router.post('/business-info', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const {text} = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({success: false, message: "Text is required"});
    }

    const businessInfo = await Business.create({clientId: clientId, text: text.trim()});
    res.status(201).json({success: true, data: businessInfo});
  }catch(error){
    console.error('Error creating business info:', error);
    res.status(500).json({success: false, message: "Failed to create business info"});
  }
});

//Get client's business id
router.get('/business-info/:id', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const { id } = req.params;

    const businessInfo = await Business.findOne({ _id: id, clientId: clientId });
    
    if (!businessInfo) {
      return res.status(404).json({success: false, message: "Business info not found"});
    }

    res.status(200).json({success: true, data: businessInfo});
  }catch(error){
    console.error('Error fetching business info:', error);
    res.status(500).json({success: false, message: "Failed to fetch business info"});
  }
});

//update client's business id
router.put('/business-info/:id', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({success: false, message: "Text is required"});
    }

    const businessInfo = await Business.findOneAndUpdate(
      { _id: id, clientId: clientId },
      { text: text.trim(), updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!businessInfo) {
      return res.status(404).json({success: false, message: "Business info not found"});
    }

    res.status(200).json({success: true, data: businessInfo});
  }catch(error){
    console.error('Error updating business info:', error);
    res.status(500).json({success: false, message: "Failed to update business info"});
  }
});

//===================== My Business ===========================

// CREATE MyBusiness
router.post('/business', extractClientId, async(req, res)=>{
  try{
    console.log(req.body);
    const clientId = req.clientId;
    const { title, category, type, image, documents, videoLink, link, description, mrp, offerPrice } = req.body;

    // Validate required fields
    if(!title || !category || !type || !image || !image.key || !description || mrp === undefined) {
      return res.status(400).json({success: false, message: "Missing required fields. Required: title, category, type, image.key, description, mrp"});
    }

    // Validate image structure
    if(typeof image !== 'object' || !image.key) {
      return res.status(400).json({success: false, message: "Image must be an object with a 'key' property."});
    }

    // Validate documents structure if provided
    if(documents && (typeof documents !== 'object' || !documents.key)) {
      return res.status(400).json({success: false, message: "Documents must be an object with a 'key' property if provided."});
    }

    // Validate mrp and offerPrice
    if(isNaN(Number(mrp)) || (offerPrice !== undefined && offerPrice !== null && isNaN(Number(offerPrice)))) {
      return res.status(400).json({success: false, message: "mrp and offerPrice must be numbers."});
    }

     // Generate S3 URLs using getobject function
     const { getobject } = require('../utils/s3');
    
     let imageWithUrl = { ...image };
     let documentsWithUrl = documents ? { ...documents } : undefined;
     
     try {
       // Generate URL for image
       const imageUrl = await getobject(image.key);
       imageWithUrl.url = imageUrl;
       
       // Generate URL for documents if provided
       if (documents && documents.key) {
         const documentsUrl = await getobject(documents.key);
         documentsWithUrl.url = documentsUrl;
       }
     } catch (s3Error) {
       console.error('Error generating S3 URLs:', s3Error);
       return res.status(500).json({success: false, message: "Error generating file URLs"});
     }
 
     // Generate unique hash for the business
     let hash;
     let isHashUnique = false;
     let attempts = 0;
     const maxAttempts = 10;
 
     while (!isHashUnique && attempts < maxAttempts) {
       hash = generateBusinessHash();
       const existingBusiness = await MyBusiness.findOne({ hash });
       if (!existingBusiness) {
         isHashUnique = true;
       }
       attempts++;
     }
 
     if (!isHashUnique) {
       return res.status(500).json({ success: false, message: "Failed to generate unique hash for business" });
     } 

     // Generate share link using the hash
     const baseUrl = 'https://aitotafrontend.vercel.app' || 'http://localhost:5173';
     const slug = title
       .toLowerCase()
       .replace(/[^a-z0-9]+/g, "-")
       .replace(/(^-|-$)/g, "");
     const shareLink = `${baseUrl}/${slug}-${hash}`;

    const business = await MyBusiness.create({
      clientId,
      title,
      category,
      type,
      image: imageWithUrl,
      documents: documentsWithUrl,
      videoLink,
      link,
      description,
      mrp: Number(mrp),
      offerPrice: offerPrice !== undefined && offerPrice !== null ? Number(offerPrice) : null,
      hash,
      Sharelink: shareLink
    });
    res.status(201).json({success: true, data: business});
  }catch(error){
    console.error('Error creating business:', error);
    res.status(500).json({success: false, message: "Failed to create business"});
  }
})

// READ: Get all businesses for a client
router.get('/business', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    let businesses = await MyBusiness.find({ clientId }).sort({ createdAt: -1 }); // Sort by creation date, most recent first
    
    // Import S3 utility for generating fresh URLs
    const { getobject } = require('../utils/s3');
    
    // Ensure image and documents always have fresh url and key fields
    businesses = await Promise.all(businesses.map(async (business) => {
      let imageUrl = '';
      let documentsUrl = '';
      
      // Generate fresh presigned URL for image if key exists
      if (business.image && business.image.key) {
        try {
          imageUrl = await getobject(business.image.key);
        } catch (error) {
          console.error('Error generating image URL:', error);
          imageUrl = '';
        }
      }
      
      // Generate fresh presigned URL for documents if key exists
      if (business.documents && business.documents.key) {
        try {
          documentsUrl = await getobject(business.documents.key);
        } catch (error) {
          console.error('Error generating documents URL:', error);
          documentsUrl = '';
        }
      }
      
      return {
        ...business.toObject(),
        image: {
          url: imageUrl,
          key: business.image && business.image.key ? business.image.key : ''
        },
        documents: {
          url: documentsUrl,
          key: business.documents && business.documents.key ? business.documents.key : ''
        }
      };
    }));
    
    res.status(200).json({ success: true, data: businesses });
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch businesses' });
  }
});

// READ: Get a single business by ID
router.get('/business/:id', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;
    let business = await MyBusiness.findOne({ _id: id, clientId });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }
    
    // Import S3 utility for generating fresh URLs
    const { getobject } = require('../utils/s3');
    
    let imageUrl = '';
    let documentsUrl = '';
    
    // Generate fresh presigned URL for image if key exists
    if (business.image && business.image.key) {
      try {
        imageUrl = await getobject(business.image.key);
      } catch (error) {
        console.error('Error generating image URL:', error);
        imageUrl = '';
      }
    }
    
    // Generate fresh presigned URL for documents if key exists
    if (business.documents && business.documents.key) {
      try {
        documentsUrl = await getobject(business.documents.key);
      } catch (error) {
        console.error('Error generating documents URL:', error);
        documentsUrl = '';
      }
    }
    
    business = {
      ...business.toObject(),
      image: {
        url: imageUrl,
        key: business.image && business.image.key ? business.image.key : ''
      },
      documents: {
        url: documentsUrl,
        key: business.documents && business.documents.key ? business.documents.key : ''
      }
    };
    res.status(200).json({ success: true, data: business });
  } catch (error) {
    console.error('Error fetching business:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch business' });
  }
});

// UPDATE: Update a business by ID
router.put('/business/:id', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;
    const updateData = req.body;
    
    // If title is being updated, regenerate the share link
    if (updateData.title) {
      const business = await MyBusiness.findById(id);
      if (business && business.hash) {
        const baseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
        const slug = updateData.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        updateData.Sharelink = `${baseUrl}/${slug}-${business.hash}`;
      }
    }
    
    const business = await MyBusiness.findOneAndUpdate(
      { _id: id, clientId },
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }
    res.status(200).json({ success: true, data: business });
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({ success: false, message: 'Failed to update business' });
  }
});

// DELETE: Delete a business by ID
router.delete('/business/:id', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { id } = req.params;
    const business = await MyBusiness.findOneAndDelete({ _id: id, clientId });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }
    res.status(200).json({ success: true, message: 'Business deleted successfully' });
  } catch (error) {
    console.error('Error deleting business:', error);
    res.status(500).json({ success: false, message: 'Failed to delete business' });
  }
});

//===================== MY Dial ===============================

router.post('/dials', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const {category, phoneNumber, leadStatus ,contactName, date, other} = req.body;

    if(!category || !phoneNumber || !contactName){
      return res.status(400).json({success: false, message: "Missing required fields. Required: category, phoneNumber, contactName"});
    }

    const dial = await MyDials.create({
      clientId : clientId,
      category,
      leadStatus,
      phoneNumber,
      contactName,
      date,
      other
    });
    res.status(201).json({success: true, data: dial});

  }catch(error){
    console.log(error);
    return json.status(400)({sucess: true, message: "Failed to add dials"})
  }
});

router.get('/dials/report', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const { filter, startDate, endDate } = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { clientId, ...dateFilter };
        
    const logs = await MyDials.find(query);
    const totalCalls = logs.length;
    const totalConnected = logs.filter(l => l.category === 'connected').length;
    const totalNotConnected = logs.filter(l => l.category === 'not connected').length;
    const totalConversationTime = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
    const avgCallDuration = totalCalls ? totalConversationTime / totalCalls : 0;
    
    res.json({ 
      success: true, 
      data: {
        clientId,
        totalCalls, 
        totalConnected, 
        totalNotConnected, 
        totalConversationTime, 
        avgCallDuration 
      },
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /dials/report', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

router.get('/dials/leads', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const {filter, startDate, endDate} = req.query;
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { clientId, ...dateFilter };    
    const logs = await MyDials.find(query).sort({ createdAt: -1 });
    
    // Group leads according to the new leadStatus structure
    const leads = {
      // Connected - Interested
      veryInterested: {
        data: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'Very Interested'),
        count: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'Very Interested').length
      },
      maybe: {
        data: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium'),
        count: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium').length
      },
      enrolled: {
        data: logs.filter(l => l.leadStatus === 'enrolled'),
        count: logs.filter(l => l.leadStatus === 'enrolled').length
      },
      
      // Connected - Not Interested
      junkLead: {
        data: logs.filter(l => l.leadStatus === 'junk lead'),
        count: logs.filter(l => l.leadStatus === 'junk lead').length
      },
      notRequired: {
        data: logs.filter(l => l.leadStatus === 'not required'),
        count: logs.filter(l => l.leadStatus === 'not required').length
      },
      enrolledOther: {
        data: logs.filter(l => l.leadStatus === 'enrolled other'),
        count: logs.filter(l => l.leadStatus === 'enrolled other').length
      },
      decline: {
        data: logs.filter(l => l.leadStatus === 'decline'),
        count: logs.filter(l => l.leadStatus === 'decline').length
      },
      notEligible: {
        data: logs.filter(l => l.leadStatus === 'not eligible'),
        count: logs.filter(l => l.leadStatus === 'not eligible').length
      },
      wrongNumber: {
        data: logs.filter(l => l.leadStatus === 'wrong number'),
        count: logs.filter(l => l.leadStatus === 'wrong number').length
      },
      
      // Connected - Followup
      hotFollowup: {
        data: logs.filter(l => l.leadStatus === 'hot followup'),
        count: logs.filter(l => l.leadStatus === 'hot followup').length
      },
      coldFollowup: {
        data: logs.filter(l => l.leadStatus === 'cold followup'),
        count: logs.filter(l => l.leadStatus === 'cold followup').length
      },
      schedule: {
        data: logs.filter(l => l.leadStatus === 'schedule'),
        count: logs.filter(l => l.leadStatus === 'schedule').length
      },
      
      // Not Connected
      notConnected: {
        data: logs.filter(l => l.leadStatus === 'not connected'),
        count: logs.filter(l => l.leadStatus === 'not connected').length
      },
      
      // Other - leads that don't match any predefined category
      other: {
        data: logs.filter(l => {
          const predefinedStatuses = [
            'vvi', 'Very Interested', 'maybe', 'medium', 'enrolled', 
            'junk lead', 'not required', 'enrolled other', 'decline', 
            'not eligible', 'wrong number', 'hot followup', 'cold followup', 
            'schedule', 'not connected'
          ];
          return !predefinedStatuses.includes(l.leadStatus);
        }),
        count: logs.filter(l => {
          const predefinedStatuses = [
            'vvi', 'Very Interested', 'maybe', 'medium', 'enrolled', 
            'junk lead', 'not required', 'enrolled other', 'decline', 
            'not eligible', 'wrong number', 'hot followup', 'cold followup', 
            'schedule', 'not connected'
          ];
          return !predefinedStatuses.includes(l.leadStatus);
        }).length
      }
    };

    res.json({ 
      success: true, 
      data: leads,
      filter: {
        applied: filter,
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error in /inbound/leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.get('/dials/done', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const {filter, startDate, endDate} = req.query;
    
    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days'];
    if (filter && !allowedFilters.includes(filter) && !startDate && !endDate) {
      return res.status(400).json({ error: 'Invalid filter parameter' });
    }
    
    let dateFilter = {};
    
    // Apply date filtering based on filter parameter
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { 
      clientId, 
      category: 'sale_done',
      ...dateFilter 
    };
    
    const data = await MyDials.find(query).sort({ createdAt: -1 });
    res.json({
      success: true,
      data: data,
      filter: {
        applied: filter,
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch done dials' });
  }
});

// ==================== HUMAN AGENT ROUTES ====================

// Get all human agents for a client
router.get('/human-agents', extractClientId,  getHumanAgents);

// Create new human agent
router.post('/human-agents', extractClientId,  createHumanAgent);

// Get single human agent
router.get('/human-agents/:agentId', extractClientId,  getHumanAgentById);

// Update human agent
router.put('/human-agents/:agentId', extractClientId,  updateHumanAgent);

// Delete human agent
router.delete('/human-agents/:agentId', extractClientId,  deleteHumanAgent);

//client assigned agent
router.get('/staff/agent', verifyClientOrHumanAgentToken, async(req,res)=>{
  try{
    const humanAgent = req.humanAgent;
    const clientId = humanAgent.clientId;
    
    // Check if human agent has assigned agents
    if (!humanAgent.agentIds || humanAgent.agentIds.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No agents assigned to this human agent' 
      });
    }
    
    // Fetch the first assigned agent (assuming one agent per human agent for now)
    const agentId = humanAgent.agentIds[0];
    const agent = await Agent.findById(agentId);
    
    if (!agent) {
      return res.status(404).json({ 
        success: false, 
        error: 'Assigned agent not found' 
      });
    }
    
    res.json({success: true, data: agent});
  }
  catch(error){
    console.error('Error in /staff/agent:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Get agent by ID (public route for mobile users)
router.get('/agents/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    const agent = await Agent.findById(id).select('-audioBytes');
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Error fetching agent by ID:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Public route to fetch minimal client details for mobile display
router.get('/public/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    let client = null;
    // Try by Mongo _id if valid
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(clientId)) {
      client = await Client.findById(clientId).lean();
    }
    // Fallbacks for installations using different id fields
    if (!client) {
      client = await Client.findOne({ clientId: clientId }).lean();
    }
    if (!client) {
      client = await Client.findOne({ userId: clientId }).lean();
    }

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const minimal = {
      id: client._id,
      name: client.name || client.clientName || 'Client',
      email: client.email || null,
      businessName: client.businessName || null,
      businessLogoUrl: client.businessLogoUrl || null,
      websiteUrl: client.websiteUrl || null,
    };

    return res.json({ success: true, data: minimal });
  } catch (error) {
    console.error('Error fetching public client details:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch client details' });
  }
});

// Get agent by ID (authenticated route)
router.get('/agents/:id', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const query = req.clientId ? { _id: id, clientId: req.clientId } : { _id: id };
    const agent = await Agent.findOne(query).select('-audioBytes');
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Error fetching agent by ID:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Get call logs by agent ID
router.get('/agents/:id/call-logs', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const { filter, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    // Validate agent exists and belongs to client
    const agent = await Agent.findOne({ _id: id, clientId: req.clientId });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Validate filter parameter
    const allowedFilters = ['today', 'yesterday', 'last7days', 'last30days'];
    if (filter && !allowedFilters.includes(filter) && (!startDate || !endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter parameter',
        message: `Filter must be one of: ${allowedFilters.join(', ')} or provide both startDate and endDate`,
        allowedFilters: allowedFilters
      });
    }
    
    // Build date filter based on parameters
    let dateFilter = {};
    
    if (filter === 'today') {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };
    } else if (filter === 'yesterday') {
      const today = new Date();
      const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
      const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (filter === 'last30days') {
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
      dateFilter = {
        createdAt: {
          $gte: thirtyDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        createdAt: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { 
      clientId: req.clientId, 
      agentId: id, 
      ...dateFilter 
    };
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total count for pagination
    const totalLogs = await CallLog.countDocuments(query);
    
    // Fetch call logs with pagination
    const logs = await CallLog.find(query)
      .sort({ time: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('campaignId', 'name description')
      .lean();
    
    // Calculate statistics
    const totalCalls = totalLogs;
    const totalConnected = logs.filter(l => l.leadStatus !== 'not_connected').length;
    const totalNotConnected = logs.filter(l => l.leadStatus === 'not_connected').length;
    const totalConversationTime = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
    const avgCallDuration = totalCalls ? totalConversationTime / totalCalls : 0;
    
    // Group by lead status for detailed breakdown
    const leadStatusBreakdown = {
      veryInterested: logs.filter(l => l.leadStatus === 'vvi' || l.leadStatus === 'very_interested').length,
      maybe: logs.filter(l => l.leadStatus === 'maybe' || l.leadStatus === 'medium').length,
      enrolled: logs.filter(l => l.leadStatus === 'enrolled').length,
      junkLead: logs.filter(l => l.leadStatus === 'junk_lead').length,
      notRequired: logs.filter(l => l.leadStatus === 'not_required').length,
      enrolledOther: logs.filter(l => l.leadStatus === 'enrolled_other').length,
      decline: logs.filter(l => l.leadStatus === 'decline').length,
      notEligible: logs.filter(l => l.leadStatus === 'not_eligible').length,
      wrongNumber: logs.filter(l => l.leadStatus === 'wrong_number').length,
      hotFollowup: logs.filter(l => l.leadStatus === 'hot_followup').length,
      coldFollowup: logs.filter(l => l.leadStatus === 'cold_followup').length,
      schedule: logs.filter(l => l.leadStatus === 'schedule').length,
      notConnected: logs.filter(l => l.leadStatus === 'not_connected').length
    };
    
    res.json({ 
      success: true, 
      data: {
        agent: {
          _id: agent._id,
          agentName: agent.agentName,
          category: agent.category,
          personality: agent.personality
        },
        logs,
        statistics: {
          totalCalls,
          totalConnected,
          totalNotConnected,
          totalConversationTime,
          avgCallDuration,
          leadStatusBreakdown
        },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalLogs / parseInt(limit)),
          totalLogs,
          hasNextPage: skip + logs.length < totalLogs,
          hasPrevPage: parseInt(page) > 1
        }
      },
      filter: {
        applied: filter || 'all',
        startDate: dateFilter.createdAt?.$gte,
        endDate: dateFilter.createdAt?.$lte
      }
    });
  } catch (error) {
    console.error('Error fetching agent call logs:', error);
    res.status(500).json({ error: 'Failed to fetch call logs' });
  }
});

// Public route for user registration (for mobile users)
router.post('/register-user', async (req, res) => {
  try {
    const { name, mobileNumber, email, clientId, sessionId } = req.body;
    
    if (!name || !mobileNumber || !clientId || !sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Name, mobile number, client ID, and session ID are required' 
      });
    }

    // Find existing user by sessionId
    let user = await User.findOne({ sessionId });
    
    if (user) {
      // Update existing user
      user.name = name;
      user.mobileNumber = mobileNumber;
      user.email = email || null;
      user.isRegistered = true;
      user.registrationAttempts = 0;
      user.lastRegistrationPrompt = null;
      await user.save();
    } else {
      // Create new user
      user = new User({
        clientId,
        name,
        mobileNumber,
        email: email || null,
        isRegistered: true,
        sessionId,
        conversations: []
      });
      await user.save();
    }

    res.json({ 
      success: true, 
      message: 'User registered successfully',
      data: {
        userId: user._id,
        name: user.name,
        mobileNumber: user.mobileNumber,
        isRegistered: user.isRegistered
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to register user' 
    });
  }
});

// Public route to get user by session ID
router.get('/user/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const user = await User.findOne({ sessionId });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      data: {
        userId: user._id,
        name: user.name,
        mobileNumber: user.mobileNumber,
        isRegistered: user.isRegistered,
        clientId: user.clientId
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch user' 
    });
  }
});

// Add this route to your client routes file (usually clientroutes.js)

// Toggle agent active status
router.patch('/agents/:agentId/toggle-active', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { isActive } = req.body;
    const clientId = req.query.clientId;

    // Validate required fields
    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required'
      });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean value'
      });
    }

    // Find the agent first
    const current = await Agent.findOne({ _id: agentId, clientId: clientId });
    if (!current) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found or you do not have permission to modify this agent'
      });
    }

    // If activating, deactivate others first to satisfy unique index
    if (isActive === true && current.accountSid) {
      await Agent.updateMany(
        {
          _id: { $ne: current._id },
          clientId: clientId,
          accountSid: current.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
    }

    // Now update this agent's active status
    const agent = await Agent.findOneAndUpdate(
      { _id: agentId, clientId: clientId },
      { isActive: isActive, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found or you do not have permission to modify this agent'
      });
    }

    console.log(`✅ [AGENT-TOGGLE] Agent ${agent.agentName} (${agentId}) ${isActive ? 'activated' : 'deactivated'} by client ${clientId}`);

    // If activating this agent and it has accountSid, deactivate others with same (clientId, accountSid)
    if (agent.isActive && agent.accountSid) {
      await Agent.updateMany(
        {
          _id: { $ne: agent._id },
          clientId: clientId,
          accountSid: agent.accountSid,
          isActive: true,
        },
        { $set: { isActive: false, updatedAt: new Date() } }
      )
    }

    res.json({
      success: true,
      message: `Agent ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        agentId: agent._id,
        agentName: agent.agentName,
        isActive: agent.isActive,
        updatedAt: agent.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ [AGENT-TOGGLE] Error toggling agent status:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to toggle agent status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// MANUAL: Trigger immediate status update for testing (optional)
router.post('/campaigns/:id/trigger-status-update', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Trigger immediate status update for this campaign
    await triggerManualStatusUpdate(campaign._id);
    
    res.json({
      success: true,
      message: 'Manual status update triggered successfully',
      data: { campaignId: campaign._id, timestamp: new Date() }
    });

  } catch (error) {
    console.error('Error triggering manual status update:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger status update' });
  }
});

// DEBUG: Check call status for debugging
router.get('/debug/call-status/:uniqueId', extractClientId, async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    // Debug the call status
    const debugInfo = await debugCallStatus(uniqueId);
    
    if (debugInfo) {
      res.json({
        success: true,
        message: 'Call status debug information',
        data: debugInfo
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Call not found or debug failed'
      });
    }

  } catch (error) {
    console.error('Error debugging call status:', error);
    res.status(500).json({ success: false, error: 'Failed to debug call status' });
  }
});

// MIGRATION: Manually trigger migration from 'missed' to 'completed'
router.post('/migrate/missed-to-completed', extractClientId, async (req, res) => {
  try {
    // Run the migration
    await migrateMissedToCompleted();
    
    res.json({
      success: true,
      message: 'Migration from missed to completed completed successfully'
    });

  } catch (error) {
    console.error('Error running migration:', error);
    res.status(500).json({ success: false, error: 'Failed to run migration' });
  }
});

// MANUAL: Trigger immediate status update for all campaigns
router.post('/trigger-status-update', extractClientId, async (req, res) => {
  try {
    console.log('🔧 MANUAL: Triggering immediate status update for all campaigns...');
    
    // Trigger manual status update
    await triggerManualStatusUpdate();
    
    res.json({
      success: true,
      message: 'Manual status update triggered successfully'
    });

  } catch (error) {
    console.error('Error triggering manual status update:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger status update' });
  }
});

// DEBUG: Check campaigns with active calls
router.get('/debug/active-campaigns', extractClientId, async (req, res) => {
  try {
    const Campaign = require('../models/Campaign');
    
    // Find all campaigns with ringing or ongoing calls
    const campaigns = await Campaign.find({
      'details.status': { $in: ['ringing', 'ongoing'] }
    }).lean();
    
    const activeCalls = [];
    
    for (const campaign of campaigns) {
      const calls = campaign.details.filter(d => d.status === 'ringing' || d.status === 'ongoing');
      calls.forEach(call => {
        activeCalls.push({
          campaignId: campaign._id,
          campaignName: campaign.name,
          uniqueId: call.uniqueId,
          status: call.status,
          timeSinceInitiation: Math.floor((new Date() - call.time) / 1000)
        });
      });
    }
    
    res.json({
      success: true,
      message: `Found ${activeCalls.length} active calls in ${campaigns.length} campaigns`,
      data: {
        totalCampaigns: campaigns.length,
        totalActiveCalls: activeCalls.length,
        activeCalls
      }
    });

  } catch (error) {
    console.error('Error checking active campaigns:', error);
    res.status(500).json({ success: false, error: 'Failed to check active campaigns' });
  }
});

// Plan and Credit Routes for Clients
router.get('/plans',  async (req, res) => {
  try {
    const Plan = require('../models/Plan');
    const plans = await Plan.getActivePlans();
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plans'
    });
  }
});

router.get('/plans/popular',  async (req, res) => {
  try {
    const Plan = require('../models/Plan');
    const plans = await Plan.getPopularPlans();
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching popular plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch popular plans'
    });
  }
});

router.get('/credits/balance', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const Credit = require('../models/Credit');
    const clientId = req.clientId;
    
    const creditRecord = await Credit.getOrCreateCreditRecord(clientId);
    
    res.json({
      success: true,
      data: creditRecord
    });
  } catch (error) {
    console.error('Error fetching credit balance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch credit balance'
    });
  }
});

router.get('/credits/history', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const Credit = require('../models/Credit');
    const clientId = req.clientId;
    const { page = 1, limit = 20, type } = req.query;
    
    const creditRecord = await Credit.findOne({ clientId })
      .populate('history.planId', 'name')
      .lean();
    
    if (!creditRecord) {
      return res.status(404).json({
        success: false,
        message: 'Credit record not found'
      });
    }
    
    // Filter and paginate history
    let history = creditRecord.history;
    if (type) {
      history = history.filter(h => h.type === type);
    }
    
    const total = history.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedHistory = history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(skip, skip + parseInt(limit));
    
    res.json({
      success: true,
      data: {
        history: paginatedHistory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching credit history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch credit history'
    });
  }
});

router.post('/plans/purchase', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { planId, billingCycle, couponCode, autoRenew } = req.body;
    const clientId = req.clientId;
    
    if (!planId || !billingCycle) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID and billing cycle are required'
      });
    }
    
    const Plan = require('../models/Plan');
    const Credit = require('../models/Credit');
    const Coupon = require('../models/Coupon');
    
    // Get plan
    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found or inactive'
      });
    }
    
    // Get or create credit record
    let creditRecord = await Credit.getOrCreateCreditRecord(clientId);
    
    // Calculate price
    let finalPrice = plan.price;
    let discountApplied = 0;
    let couponUsed = null;
    
    // Apply billing cycle discount
    const cycleDiscount = plan.discounts[`${billingCycle}Discount`] || 0;
    if (cycleDiscount > 0) {
      discountApplied = (finalPrice * cycleDiscount) / 100;
      finalPrice -= discountApplied;
    }
    
    // Apply coupon if provided
    if (couponCode) {
      const coupon = await Coupon.findValidCoupon(couponCode);
      if (coupon && coupon.appliesToPlan(planId, plan.category)) {
        const couponDiscount = coupon.calculateDiscount(finalPrice);
        finalPrice -= couponDiscount;
        discountApplied += couponDiscount;
        couponUsed = coupon.code;
      }
    }
    
    // Calculate credits to add
    const creditsToAdd = plan.creditsIncluded + plan.bonusCredits;
    
    // Add credits to client account
    await creditRecord.addCredits(
      creditsToAdd,
      'purchase',
      `Plan purchase: ${plan.name} (${billingCycle})`,
      planId,
      `TXN_${Date.now()}`
    );
    
    // Update current plan information
    const startDate = new Date();
    let endDate = new Date();
    
    switch (billingCycle) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }
    
    creditRecord.currentPlan = {
      planId: planId,
      startDate: startDate,
      endDate: endDate,
      billingCycle: billingCycle,
      autoRenew: autoRenew || false
    };
    
    await creditRecord.save();
    
    // Apply coupon usage if used
    if (couponUsed) {
      const coupon = await Coupon.findValidCoupon(couponCode);
      if (coupon) {
        await coupon.applyCoupon(clientId, planId, plan.price);
      }
    }
    
    res.json({
      success: true,
      message: 'Plan purchased successfully',
      data: {
        plan: plan.name,
        creditsAdded: creditsToAdd,
        price: plan.price,
        discountApplied: discountApplied,
        finalPrice: finalPrice,
        billingCycle: billingCycle,
        startDate: startDate,
        endDate: endDate,
        couponUsed: couponUsed,
        newBalance: creditRecord.currentBalance
      }
    });
  } catch (error) {
    console.error('Error purchasing plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to purchase plan'
    });
  }
});

router.post('/coupons/validate',  async (req, res) => {
  try {
    const { couponCode, planId } = req.body;
    const clientId = req.clientId;
    
    if (!couponCode || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code and plan ID are required'
      });
    }
    
    const Coupon = require('../models/Coupon');
    const Plan = require('../models/Plan');
    
    const coupon = await Coupon.findValidCoupon(couponCode);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired coupon'
      });
    }
    
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    // Check if coupon applies to plan
    if (!coupon.appliesToPlan(planId, plan.category)) {
      return res.status(400).json({
        success: false,
        message: 'Coupon not applicable to this plan'
      });
    }
    
    // Check if user can use coupon
    const canUse = await coupon.canBeUsedBy(clientId);
    if (!canUse.valid) {
      return res.status(400).json({
        success: false,
        message: canUse.reason
      });
    }
    
    const discount = coupon.calculateDiscount(plan.price);
    
    res.json({
      success: true,
      message: 'Coupon is valid',
      data: {
        coupon: {
          code: coupon.code,
          name: coupon.name,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        },
        discount: discount,
        finalPrice: plan.price - discount
      }
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate coupon'
    });
  }
});

router.put('/credits/settings', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { lowBalanceAlert, autoPurchase } = req.body;
    const clientId = req.clientId;
    
    const Credit = require('../models/Credit');
    const creditRecord = await Credit.findOne({ clientId });
    
    if (!creditRecord) {
      return res.status(404).json({
        success: false,
        message: 'Credit record not found'
      });
    }
    
    if (lowBalanceAlert) {
      creditRecord.settings.lowBalanceAlert = {
        ...creditRecord.settings.lowBalanceAlert,
        ...lowBalanceAlert
      };
    }
    
    if (autoPurchase) {
      creditRecord.settings.autoPurchase = {
        ...creditRecord.settings.autoPurchase,
        ...autoPurchase
      };
    }
    
    await creditRecord.save();
    
    res.json({
      success: true,
      message: 'Credit settings updated successfully',
      data: creditRecord.settings
    });
  } catch (error) {
    console.error('Error updating credit settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update credit settings'
    });
  }
});

// Confirm Paytm payment and credit static plan
router.post('/credits/paytm/confirm', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { orderId, planKey } = req.body;
    const clientId = req.clientId;

    if (!orderId || !planKey) {
      return res.status(400).json({ success: false, message: 'orderId and planKey are required' });
    }

    const Credit = require('../models/Credit');
    const creditRecord = await Credit.getOrCreateCreditRecord(clientId);

    // Idempotency: don't apply if this orderId already in history
    const alreadyApplied = (creditRecord.history || []).some(h => h.transactionId === String(orderId));
    if (alreadyApplied) {
      return res.json({ success: true, message: 'Payment already applied', data: { balance: creditRecord.currentBalance } });
    }

    const mapping = {
      basic: { credits: 1000, bonus: 0, price: 1000 },
      professional: { credits: 5000, bonus: 500, price: 5000 },
      enterprise: { credits: 10000, bonus: 1000, price: 10000 },
    };

    const key = String(planKey).toLowerCase();
    const plan = mapping[key];
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Invalid planKey' });
    }

    const totalCredits = plan.credits + (plan.bonus || 0);

    await creditRecord.addCredits(totalCredits, 'purchase', `Paytm order ${orderId} • ${key} plan`, null, String(orderId));

    return res.json({ success: true, message: 'Credits added', data: { balance: creditRecord.currentBalance, added: totalCredits } });
  } catch (error) {
    console.error('Error confirming Paytm payment:', error);
    res.status(500).json({ success: false, message: 'Failed to confirm payment' });
  }
});

// Initiate Paytm payment from backend and handle redirect server-side
router.post('/payments/initiate', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { amount, customerEmail, customerPhone, customerName, planKey } = req.body || {};
    if (!amount) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }

    // Fallback billing data from client profile if not provided
    let email = customerEmail;
    let phone = customerPhone;
    let name = customerName;
    try {
      const Client = require('../models/Client');
      const client = await Client.findById(req.clientId);
      if (client) {
        if (!email) email = client.email;
        if (!phone) phone = client.mobileNo;
        if (!name) name = client.name;
      }
    } catch {}

    // Final fallbacks
    if (!email) email = 'client@example.com';
    if (!phone) phone = '9999999999';
    if (!name) name = 'Client';

    // Call external Paytm gateway API
    const axios = require('axios');
    const gatewayBase = 'https://paytm-gateway-n0py.onrender.com';
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const payload = {
      amount,
      customerEmail: email,
      customerPhone: phone,
      customerName: name,
      projectId: 'aitota-pricing',
      redirectUrl: `${FRONTEND_URL}/auth/dashboard`
    };
    const gwResp = await axios.post(`${gatewayBase}/api/paytm/initiate`, payload, { timeout: 15000 });
    const data = gwResp.data || {};

    if (!data.success) {
      return res.status(500).json({ success: false, message: data.message || 'Payment initiation failed' });
    }

    // Prefer gateway redirectUrl if present
    if (data.redirectUrl) {
      return res.redirect(302, data.redirectUrl);
    }

    // Otherwise render an HTML form auto-submitting to Paytm
    const paytmUrl = data.paytmUrl;
    const params = data.paytmParams || {};
    if (!paytmUrl) {
      return res.status(500).json({ success: false, message: 'Missing paytmUrl from gateway' });
    }
    const inputs = Object.entries(params)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v)}"/>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Redirecting…</title></head><body>
      <form id=\"paytmForm\" method=\"POST\" action=\"${paytmUrl}\">${inputs}</form>
      <script>document.getElementById('paytmForm').submit();</script>
    </body></html>`;
    res.status(200).send(html);
  } catch (error) {
    console.error('Error initiating payment:', error.message);
    res.status(500).json({ success: false, message: 'Failed to initiate payment' });
  }
});

// GET variant for browser redirects without Authorization header. Token passed as query param 't'.
router.get('/payments/initiate/direct', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const { t, amount, planKey } = req.query || {};
    try { console.log('[INITIATE/DIRECT] query:', req.query); } catch {}
    if (!t) return res.status(401).send('Missing token');
    if (!amount) return res.status(400).send('Missing amount');
    const planKeyNorm = (typeof planKey === 'string' ? planKey : String(planKey || '')).toLowerCase();
    if (!planKeyNorm) return res.status(400).send('Missing planKey');

    let clientId;
    try {
      const decoded = jwt.verify(t, process.env.JWT_SECRET);
      if (decoded?.userType !== 'client') return res.status(401).send('Invalid token');
      clientId = decoded.id;
    } catch (e) {
      return res.status(401).send('Invalid token');
    }

    // Billing info from client profile
    const Client = require('../models/Client');
    const client = await Client.findById(clientId);
    let email = client?.email || 'client@example.com';
    let phone = client?.mobileNo || '9999999999';
    // Normalize phone to 10 digits as Cashfree expects
    try {
      const digits = String(phone || '').replace(/\D/g, '');
      if (digits.length >= 10) {
        phone = digits.slice(-10);
      }
    } catch {}
    let name = client?.name || 'Client';

    // Create Cashfree order and redirect to hosted checkout
    const orderId = `AITOTA_${Date.now()}`;
    const axios = require('axios');
    // Persist INITIATED payment
    try {
      const Payment = require('../models/Payment');
      await Payment.create({ clientId, orderId, planKey: planKeyNorm, amount: Number(amount), email, phone, status: 'INITIATED' });
    } catch (e) { console.error('Payment INITIATED save failed:', e.message); }

    const headers = {
      'x-client-id': CashfreeConfig.CLIENT_ID,
      'x-client-secret': CashfreeConfig.CLIENT_SECRET,
      'x-api-version': '2022-09-01',
      'Content-Type': 'application/json'
    };
    const payload = {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: String(clientId),
        customer_email: email,
        customer_phone: phone,
        customer_name: name
      },
      order_meta: {
        return_url: CashfreeConfig.RETURN_URL
      }
    };
    let cf;
    try {
      const cfResp = await axios.post(`${CashfreeConfig.BASE_URL}/pg/orders`, payload, { headers });
      cf = cfResp.data || {};
    } catch (e) {
      const status = e.response?.status;
      const data = e.response?.data;
      console.error('Cashfree create order failed:', status, data || e.message);
      return res.status(502).json({ success: false, message: 'Cashfree create order failed', status, data });
    }
    // Prefer payment_link. If missing, fallback to hosted checkout via payment_session_id
    if (cf.payment_link) {
      return res.redirect(302, cf.payment_link);
    }
    if (cf.payment_session_id) {
      let sessionId = String(cf.payment_session_id);
      sessionId = sessionId.replace(/(payment)+$/i, '');
      // Use our own drop-in host page to avoid hosted 500 issues
      const backendBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
      return res.redirect(302, `${backendBase}/api/v1/cashfree/hosted?session_id=${encodeURIComponent(sessionId)}`);
    }
    // Final fallback to Cashfree order view URL
    if (cf.order_id || cf.cf_order_id) {
      const orderIdView = String(cf.order_id || cf.cf_order_id);
      const viewBase = (CashfreeConfig.ENV === 'prod' || CashfreeConfig.ENV === 'production')
        ? 'https://payments.cashfree.com/pg/view/order/'
        : 'https://sandbox.cashfree.com/pg/view/order/';
      return res.redirect(302, viewBase + orderIdView);
    }
    console.error('Cashfree response missing both payment_link and payment_session_id:', cf);
    return res.status(500).json({ success: false, message: 'Failed to get Cashfree payment link', data: cf });
  } catch (error) {
    console.error('Error in direct initiate:', error.message || error);
    const msg = error?.message || 'Failed to initiate payment';
    res.status(500).json({ success: false, message: msg });
  }
});

// POST /api/v1/client/credits/paytm/confirm
// Accepts { orderId, planKey } from frontend after redirect
router.post('/credits/paytm/confirm', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { orderId, planKey } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId missing' });
    }
    const plan = (planKey || '').toLowerCase();
    let creditsToAdd = 0;
    if (plan === 'basic') creditsToAdd = 1000;
    else if (plan === 'professional') creditsToAdd = 5500; // includes 500 bonus
    else if (plan === 'enterprise') creditsToAdd = 11000; // includes 1000 bonus

    if (!creditsToAdd) {
      return res.status(400).json({ success: false, message: 'Unknown planKey' });
    }

    const Credit = require('../models/Credit');
    const credit = await Credit.getOrCreateCreditRecord(req.clientId);
    await credit.addCredits(creditsToAdd, 'purchase', `Paytm order ${orderId}`, {
      gateway: 'paytm',
      orderId,
      planKey: plan,
    });
    return res.json({ success: true, message: 'Credits applied', data: { balance: credit.currentBalance } });
  } catch (e) {
    console.error('Paytm confirm error:', e.message);
    return res.status(500).json({ success: false, message: 'Failed to apply credits' });
  }
});


module.exports = router;

