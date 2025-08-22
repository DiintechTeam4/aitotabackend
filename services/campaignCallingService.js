const axios = require('axios');
const ApiKey = require('../models/ApiKey');
const CallLog = require('../models/CallLog');
const mongoose = require('mongoose');

// In-memory storage for campaign calling progress
const campaignCallingProgress = new Map();
const activeCampaigns = new Map();

/**
 * Get client API key from database
 */
async function getClientApiKey(clientId) {
  try {
    const apiKey = await ApiKey.findOne({ clientId, isActive: true });
    return apiKey ? apiKey.key : null;
  } catch (error) {
    console.error('Error fetching API key:', error);
    return null;
  }
}

/**
 * Generate unique ID for call tracking
 */
function generateUniqueId() {
  return `aidial-${Date.now()}-${performance.now().toString(36).replace(".", "")}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Make a single call to a contact
 */
async function makeSingleCall(contact, agentId, apiKey, campaignId, clientId) {
  try {
    const uniqueId = generateUniqueId();
    
    const callPayload = {
      transaction_id: "CTI_BOT_DIAL",
      phone_num: contact.phone.replace(/[^\d]/g, ""),
      uniqueid: uniqueId,
      callerid: "168353225",
      uuid: clientId || "client-uuid-001",
      custom_param: {
        uniqueid: uniqueId,
        name: contact.name
      },
      resFormat: 3,
    };

    // Make call to external API
    const response = await axios.post(
      'https://3neysomt18.execute-api.us-east-1.amazonaws.com/dev/clicktobot',
      callPayload,
      {
        headers: {
          'X-CLIENT': 'czobd',
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    // Store call log
    const callLog = new CallLog({
      clientId,
      campaignId,
      agentId,
      phoneNumber: contact.phone,
      contactName: contact.name,
      callType: 'outbound',
      status: 'initiated',
      metadata: {
        uniqueId,
        customParams: callPayload.custom_param,
        externalResponse: response.data
      },
      createdAt: new Date()
    });
    await callLog.save();

    return {
      success: true,
      uniqueId,
      contact,
      timestamp: new Date(),
      externalResponse: response.data
    };

  } catch (error) {
    console.error('Error making single call:', error);
    
    // Log failed call
    const callLog = new CallLog({
      clientId,
      campaignId,
      agentId,
      phoneNumber: contact.phone,
      contactName: contact.name,
      callType: 'outbound',
      status: 'failed',
      metadata: {
        error: error.message,
        customParams: {
          campaignId: campaignId.toString(),
          agentId: agentId,
          contactId: contact._id.toString()
        }
      },
      createdAt: new Date()
    });
    await callLog.save();

    return {
      success: false,
      error: error.message,
      contact,
      timestamp: new Date()
    };
  }
}

/**
 * Start campaign calling process
 */
async function startCampaignCalling(campaign, agentId, apiKey, delayBetweenCalls, clientId) {
  const campaignId = campaign._id.toString();
  
  // Initialize progress tracking
  const progress = {
    campaignId,
    totalContacts: campaign.contacts.length,
    currentIndex: 0,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    startTime: new Date(),
    isRunning: true,
    lastCallTime: null
  };

  campaignCallingProgress.set(campaignId, progress);
  activeCampaigns.set(campaignId, true);

  console.log(`Starting campaign calling for campaign ${campaignId} with ${campaign.contacts.length} contacts`);

  // Process calls in background
  processCampaignCalls(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress);
}

/**
 * Process campaign calls in background
 */
async function processCampaignCalls(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress) {
  const campaignId = campaign._id.toString();
  
  try {
    for (let i = 0; i < campaign.contacts.length; i++) {
      // Check if campaign should stop
      if (!activeCampaigns.get(campaignId)) {
        console.log(`Campaign ${campaignId} stopped by user`);
        break;
      }

      // Update progress
      progress.currentIndex = i;
      campaignCallingProgress.set(campaignId, progress);

      const contact = campaign.contacts[i];
      console.log(`Calling ${contact.name} at ${contact.phone} (${i + 1}/${campaign.contacts.length})`);

      // Make the call
      const callResult = await makeSingleCall(contact, agentId, apiKey, campaign._id, clientId);
      
      // Update progress
      progress.completedCalls++;
      progress.lastCallTime = new Date();
      
      if (callResult.success) {
        progress.successfulCalls++;
        
        // Add unique ID to campaign if call was successful
        if (callResult.uniqueId && !campaign.uniqueIds.includes(callResult.uniqueId)) {
          campaign.uniqueIds.push(callResult.uniqueId);
          await campaign.save();
        }
      } else {
        progress.failedCalls++;
      }

      campaignCallingProgress.set(campaignId, progress);

      // Wait before next call (except for last call)
      if (i < campaign.contacts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
      }
    }

    // Campaign completed
    console.log(`Campaign ${campaignId} calling completed`);
    progress.isRunning = false;
    progress.endTime = new Date();
    campaignCallingProgress.set(campaignId, progress);
    activeCampaigns.delete(campaignId);

    // Update campaign status
    const updatedCampaign = await mongoose.model('Campaign').findById(campaign._id);
    if (updatedCampaign) {
      updatedCampaign.isRunning = false;
      await updatedCampaign.save();
    }

  } catch (error) {
    console.error(`Error in campaign calling process for ${campaignId}:`, error);
    progress.isRunning = false;
    progress.error = error.message;
    campaignCallingProgress.set(campaignId, progress);
    activeCampaigns.delete(campaignId);

    // Update campaign status
    const updatedCampaign = await mongoose.model('Campaign').findById(campaign._id);
    if (updatedCampaign) {
      updatedCampaign.isRunning = false;
      await updatedCampaign.save();
    }
  }
}

/**
 * Stop campaign calling process
 */
function stopCampaignCalling(campaignId) {
  activeCampaigns.delete(campaignId);
  
  const progress = campaignCallingProgress.get(campaignId);
  if (progress) {
    progress.isRunning = false;
    progress.endTime = new Date();
    campaignCallingProgress.set(campaignId, progress);
  }
  
  console.log(`Campaign ${campaignId} calling stopped`);
}

/**
 * Get campaign calling progress
 */
function getCampaignCallingProgress(campaignId) {
  return campaignCallingProgress.get(campaignId) || null;
}

/**
 * Get all active campaigns
 */
function getActiveCampaigns() {
  return Array.from(activeCampaigns.keys());
}

/**
 * Clean up completed campaigns (run periodically)
 */
function cleanupCompletedCampaigns() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

  for (const [campaignId, progress] of campaignCallingProgress.entries()) {
    if (!progress.isRunning && progress.endTime && progress.endTime < oneHourAgo) {
      campaignCallingProgress.delete(campaignId);
      console.log(`Cleaned up completed campaign ${campaignId}`);
    }
  }
}

// Clean up completed campaigns every hour
setInterval(cleanupCompletedCampaigns, 60 * 60 * 1000);

module.exports = {
  getClientApiKey,
  makeSingleCall,
  startCampaignCalling,
  stopCampaignCalling,
  getCampaignCallingProgress,
  getActiveCampaigns,
  cleanupCompletedCampaigns
};
