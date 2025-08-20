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
    
    // Build the complete query
    const query = { clientId, ...dateFilter };
        
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

// Inbound Logs/Conversation
router.get('/inbound/logs', extractClientId, async (req, res) => {
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
    const query = { clientId, ...dateFilter};
    const agentName = {}
    
    const clientName = await Client.findOne({ _id: clientId }).select('name');
    const logs = await CallLog.find(query)
      .sort({ createdAt: -1 })
      .populate('agentId', 'agentName')
      .lean();
    const logsWithAgentName = logs.map(l => ({
      ...l,
      agentName: l.agentId && l.agentId.agentName ? l.agentId.agentName : null,
    }));
    res.json({success:'true', clientName: clientName ,data:logsWithAgentName});
  } catch (error) {
    console.error('Error in /inbound/logs:', error);
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
    
    // Build the complete query
    const query = { clientId, ...dateFilter };    
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
        // Check if contact already exists
        const existingContact = await Contacts.findOne({ 
          clientId, 
          phone: contact.phone.trim() 
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

        // Create new contact
        const newContact = new Contacts({
          name: contact.name.trim(),
          phone: contact.phone.trim(),
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

    const group = await Group.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ 
        success: false,
        error: 'Group not found' 
      });
    }

    // Check if phone number already exists in the group
    const existingContact = group.contacts.find(contact => contact.phone === phone.trim());
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
        message: `Phone number ${phone.trim()} is already assigned to contact "${existingContact.name}" in group "${group.name}"`
      });
    }

    const contact = {
      name: typeof name === 'string' ? name.trim() : '',
      phone: phone.trim(),
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
    
    // Update status for each campaign based on current date
    const updatedCampaigns = campaigns.map(campaign => {
      campaign.updateStatus();
      return campaign;
    });
    
    res.json({ success: true, data: updatedCampaigns });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Create new campaign
router.post('/campaigns', extractClientId, async (req, res) => {
  try {
    const { name, description, groupIds, startDate, endDate } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (start >= end) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    // Check for duplicate campaign name within the same client
    const campaignNameMatch = await Campaign.findOne({
      name: { $regex: name.trim(), $options: 'i' },
      clientId: req.clientId
    });
    if (campaignNameMatch) {
      return res.status(400).json({ error: 'Campaign name already exists' });
    }

    const campaign = new Campaign({
      name: name.trim(),
      description: description?.trim() || '',
      groupIds: groupIds || [],
      clientId: req.clientId,
      startDate: start,
      endDate: end
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
    const { name, description, groupIds, startDate, endDate } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    // Check for duplicate campaign name within the same client (excluding current campaign)
    const campaignNameMatch = await Campaign.findOne({
      name: { $regex: name.trim(), $options: 'i' },
      clientId: req.clientId,
      _id: { $ne: req.params.id }
    });
    if (campaignNameMatch) {
      return res.status(400).json({ error: 'Campaign name already exists' });
    }

    const updateData = {
      name: name.trim(),
      description: description?.trim() || '',
      updatedAt: new Date()
    };

    if (groupIds !== undefined) {
      updateData.groupIds = groupIds;
    }

    // Handle date updates
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ error: 'Invalid start date format' });
      }
      updateData.startDate = start;
    }

    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid end date format' });
      }
      updateData.endDate = end;
    }

    // Validate date range if both dates are provided
    if (updateData.startDate && updateData.endDate && updateData.startDate >= updateData.endDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      updateData,
      { new: true }
    ).populate('groupIds', 'name description');

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Update status based on new dates
    campaign.updateStatus();
    await campaign.save();

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

    // Add unique ID if it doesn't already exist
    if (!campaign.uniqueIds.includes(uniqueId)) {
      campaign.uniqueIds.push(uniqueId);
      await campaign.save();
    }

    res.json({ 
      success: true, 
      message: 'Unique ID added to campaign',
      data: { uniqueId, totalUniqueIds: campaign.uniqueIds.length }
    });
  } catch (error) {
    console.error('Error adding unique ID to campaign:', error);
    res.status(500).json({ error: 'Failed to add unique ID to campaign' });
  }
});

// Get call logs for a campaign using stored uniqueIds
router.get('/campaigns/:id/call-logs', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = (req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const uniqueIds = Array.isArray(campaign.uniqueIds) ? campaign.uniqueIds.filter(Boolean) : [];
    if (uniqueIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        campaign: { _id: campaign._id, name: campaign.name, uniqueIdsCount: 0 },
        pagination: { currentPage: page, totalPages: 0, totalLogs: 0, hasNextPage: false, hasPrevPage: false }
      });
    }

    const query = {
      clientId: req.clientId,
      'metadata.customParams.uniqueid': { $in: uniqueIds }
    };

    const totalLogs = await CallLog.countDocuments(query);
    const skip = (page - 1) * limit;
    const sortSpec = { [sortBy]: sortOrder };

    const logs = await CallLog.find(query)
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .populate('campaignId', 'name description')
      .populate('agentId', 'agentName')
      .lean();

    return res.json({
      success: true,
      data: logs,
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        uniqueIdsCount: uniqueIds.length
      },
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalLogs / limit),
        totalLogs,
        hasNextPage: skip + logs.length < totalLogs,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching campaign call logs:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch campaign call logs' });
  }
});

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

    // Fetch all groups and their contacts
    const groups = await Group.find({ _id: { $in: campaign.groupIds } });
    
    let totalContacts = 0;
    let totalGroups = groups.length;
    const newContacts = [];

    for (const group of groups) {
      if (group.contacts && group.contacts.length > 0) {
        for (const groupContact of group.contacts) {
          // Check if phone number already exists in campaign contacts
          const existingContact = campaign.contacts.find(contact => contact.phone === groupContact.phone);
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

    // Add new contacts to campaign
    if (newContacts.length > 0) {
      campaign.contacts.push(...newContacts);
      await campaign.save();
    }

    res.json({
      success: true,
      data: {
        totalContacts: totalContacts,
        totalGroups: totalGroups,
        newContactsAdded: newContacts.length
      },
      message: `Synced ${newContacts.length} new contacts from ${totalGroups} groups`
    });
  } catch (error) {
    console.error('Error syncing contacts from groups:', error);
    res.status(500).json({ success: false, error: 'Failed to sync contacts from groups' });
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

// Sync contacts from groups to campaign
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

    // Fetch all groups and their contacts
    const groups = await Group.find({ _id: { $in: campaign.groupIds } });
    
    let totalContacts = 0;
    let totalGroups = groups.length;
    const newContacts = [];

    for (const group of groups) {
      if (group.contacts && group.contacts.length > 0) {
        for (const groupContact of group.contacts) {
          // Check if phone number already exists in campaign contacts
          const existingContact = campaign.contacts.find(contact => contact.phone === groupContact.phone);
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

    // Add new contacts to campaign
    if (newContacts.length > 0) {
      campaign.contacts.push(...newContacts);
      await campaign.save();
    }

    res.json({
      success: true,
      data: {
        totalContacts: totalContacts,
        totalGroups: totalGroups,
        newContactsAdded: newContacts.length
      },
      message: `Synced ${newContacts.length} new contacts from ${totalGroups} groups`
    });
  } catch (error) {
    console.error('Error syncing contacts from groups:', error);
    res.status(500).json({ success: false, error: 'Failed to sync contacts from groups' });
  }
});

// Add contact to campaign
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
      return res.status(400).json({ success: false, error: 'Contact with this phone number already exists in this campaign' });
    }

    const newContact = {
      name,
      phone,
      email: email || "",
      isActive: true,
      addedAt: new Date()
    };

    campaign.contacts.push(newContact);
    await campaign.save();

    res.json({
      success: true,
      message: 'Contact added successfully',
      contact: newContact
    });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ success: false, error: 'Failed to add contact' });
  }
});

// Update contact in campaign
router.put('/campaigns/:id/contacts/:contactIndex', extractClientId, async (req, res) => {
  try {
    const { id, contactIndex } = req.params;
    const { name, phone, email } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone are required' });
    }

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const index = parseInt(contactIndex);
    if (index < 0 || index >= campaign.contacts.length) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    // Check if phone number already exists in other contacts (excluding current one)
    const existingContact = campaign.contacts.find((contact, i) => i !== index && contact.phone === phone);
    if (existingContact) {
      return res.status(400).json({ success: false, error: 'Contact with this phone number already exists in this campaign' });
    }

    // Update the contact
    campaign.contacts[index] = {
      ...campaign.contacts[index],
      name,
      phone,
      email: email || "",
      updatedAt: new Date()
    };

    await campaign.save();

    res.json({
      success: true,
      message: 'Contact updated successfully',
      contact: campaign.contacts[index]
    });
  } catch (error) {
    console.error('Error updating contact:', error);
    res.status(500).json({ success: false, error: 'Failed to update contact' });
  }
});

// Remove contact from campaign
router.delete('/campaigns/:id/contacts/:contactIndex', extractClientId, async (req, res) => {
  try {
    const { id, contactIndex } = req.params;
    const index = parseInt(contactIndex);

    const campaign = await Campaign.findOne({ _id: id, clientId: req.clientId });
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (index < 0 || index >= campaign.contacts.length) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    const removedContact = campaign.contacts.splice(index, 1)[0];
    await campaign.save();

    res.json({
      success: true,
      message: 'Contact removed successfully',
      removedContact
    });
  } catch (error) {
    console.error('Error removing contact:', error);
    res.status(500).json({ success: false, error: 'Failed to remove contact' });
  }
});


module.exports = router;

