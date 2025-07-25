const express = require('express');
const router = express.Router();
const { loginClient, registerClient, getClientProfile, getAllUsers, getUploadUrl, googleLogin } = require('../controllers/clientcontroller');
const { authMiddleware } = require('../middlewares/authmiddleware');
const { verifyGoogleToken } = require('../middlewares/googleAuth');
const Client = require("../models/Client")
const ClientApiService = require("../services/ClientApiService")
const Agent = require('../models/Agent');
const VoiceService = require('../services/voiceService');
const voiceService = new VoiceService();
const CallLog = require('../models/CallLog');
const AgentSettings = require('../models/AgentSettings');

const clientApiService = new ClientApiService()

// Middleware to extract client ID
const extractClientId = (req, res, next) => {
  const clientId = req.headers["x-client-id"] || req.query.clientId || "default-client"
  req.clientId = clientId
  next()
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

router.post('/google-login',verifyGoogleToken, googleLogin);

router.post('/register', registerClient);

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

// Get all agents for client
router.get('/agents', extractClientId, async (req, res) => {
  try {
    const agents = await Agent.find({ clientId: req.clientId })
      .select('-audioBytes') // Don't send audio bytes in list view
      .sort({ createdAt: -1 });
    res.json(agents);
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
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
      "Content-Type": "application/json"
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
    const logs = await CallLog.find({ clientId });
    const totalCalls = logs.length;
    const totalConnected = logs.filter(l => l.leadStatus !== 'not_connected').length;
    const totalNotConnected = logs.filter(l => l.leadStatus === 'not_connected').length;
    const totalConversationTime = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
    const avgCallDuration = totalCalls ? totalConversationTime / totalCalls : 0;
    res.json({ totalCalls, totalConnected, totalNotConnected, totalConversationTime, avgCallDuration });
  } catch (error) {
    console.error('Error in /inbound/report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Inbound Logs/Conversation
router.get('/inbound/logs', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const logs = await CallLog.find({ clientId });
    res.json(logs);
  } catch (error) {
    console.error('Error in /inbound/logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Inbound Leads
router.get('/inbound/leads', extractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    const logs = await CallLog.find({ clientId });
    const leads = {
      veryInterested: logs.filter(l => l.leadStatus === 'very_interested'),
      medium: logs.filter(l => l.leadStatus === 'medium'),
      notInterested: logs.filter(l => l.leadStatus === 'not_interested')
    };
    res.json(leads);
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


module.exports = router;

