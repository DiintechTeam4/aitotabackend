const express = require('express');
const router = express.Router();
const { loginClient, registerClient, getClientProfile, getAllUsers, getUploadUrl, googleLogin, getHumanAgents, createHumanAgent, updateHumanAgent, deleteHumanAgent, getHumanAgentById, loginHumanAgent } = require('../controllers/clientcontroller');
const { authMiddleware, verifyAdminTokenOnlyForRegister, verifyAdminToken, verifyClientToken } = require('../middlewares/authmiddleware');
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
const BusinessInfo = require('../models/BusinessInfo');

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
    let client = await Client.findOne({ clientId: req.clientId })
    if (!client) {
      client = new Client({
        clientId: req.clientId,
        clientName: `Client ${req.clientId}`,
        email: `${req.clientId}@example.com`,
        status: "active",
      })
      await client.save()
    }
    res.json({ success: true, data: client })
  } catch (error) {
    console.error("Error fetching/creating client:", error)
    res.status(500).json({ error: "Failed to fetch client information" })
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

router.get('/upload-url',getUploadUrl)

router.post('/login', loginClient);

router.post('/human-agent/login', loginHumanAgent);

router.post('/google-login',verifyGoogleToken, googleLogin);

router.post('/register',verifyAdminTokenOnlyForRegister, registerClient);

router.get('/profile', authMiddleware, getClientProfile);

// Create new agent with multiple starting messages and default selection
router.post('/agents', extractClientId, async (req, res) => {
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
    agentData.clientId = req.clientId;
    const agent = new Agent(agentData);
    const savedAgent = await agent.save();
    const responseAgent = savedAgent.toObject();
    delete responseAgent.audioBytes;
    res.status(201).json(responseAgent);
  } catch (error) {
    console.error('❌ Error creating agent:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// Update agent with multiple starting messages and default selection
router.put('/agents/:id', extractClientId, async (req, res) => {
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
    const agent = await Agent.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      agentData,
      { new: true, runValidators: true }
    );
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
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

router.delete('/agents/:id', extractClientId, async (req, res)=>{
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
router.get('/agents', extractClientId, async (req, res) => {
  try {
    const agents = await Agent.find({ clientId: req.clientId })
      .select('-audioBytes') // Don't send audio bytes in list view
      .sort({ createdAt: -1 });
    res.json({success: true, data: agents});
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ success: false, error: "Failed to fetch agents" });
  }
});

// Get agent audio
router.get('/agents/:id/audio', extractClientId, async (req, res) => {
  try {
    const { id } = req.params;
    const agent = await Agent.findOne({ _id: id, clientId: req.clientId });
    
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
router.post('/voice/synthesize', extractClientId, async (req, res) => {
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
      channels: audioResult.channels
    });
  } catch (error) {
    console.error("❌ Voice synthesis error:", error);
    res.status(500).json({ error: `Voice synthesis failed: ${error.message}` });
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
        time: {
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
        time: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        time: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        time: {
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
        startDate: dateFilter.time?.$gte,
        endDate: dateFilter.time?.$lte
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
        time: {
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
        time: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        time: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        time: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { clientId, ...dateFilter };
    
    const clientName = await Client.findOne({ _id: clientId }).select('name');
    const logs = await CallLog.find(query);
    res.json({success:'true', clientName: clientName ,data:logs});
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
        time: {
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
        time: {
          $gte: startOfYesterday,
          $lte: endOfYesterday
        }
      };
    } else if (filter === 'last7days') {
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      dateFilter = {
        time: {
          $gte: sevenDaysAgo,
          $lte: today
        }
      };
    } else if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        time: {
          $gte: start,
          $lte: end
        }
      };
    }
    
    // Build the complete query
    const query = { clientId, ...dateFilter };    
    const logs = await CallLog.find(query);
    
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
        startDate: dateFilter.time?.$gte,
        endDate: dateFilter.time?.$lte
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
    const { name, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = new Group({
      name: name.trim(),
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
    const { name, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { 
        name: name.trim(), 
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
    
    if (!name || !name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const group = await Group.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const contact = {
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || '',
      createdAt: new Date()
    };

    group.contacts.push(contact);
    await group.save();

    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ error: 'Failed to add contact' });
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

// ==================== BUSINESS INFO API ====================
//create client business id
router.post('/business-info', extractClientId, async(req,res)=>{
  try{
    const clientId = req.clientId;
    const {text} = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({success: false, message: "Text is required"});
    }

    const businessInfo = await BusinessInfo.create({clientId: clientId, text: text.trim()});
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

    const businessInfo = await BusinessInfo.findOne({ _id: id, clientId: clientId });
    
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

    const businessInfo = await BusinessInfo.findOneAndUpdate(
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

module.exports = router;

