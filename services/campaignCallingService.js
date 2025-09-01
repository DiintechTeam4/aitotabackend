const axios = require('axios');
const ApiKey = require('../models/ApiKey');
const CallLog = require('../models/CallLog');
const mongoose = require('mongoose');

/**
 * AUTOMATIC: Update call status in campaign based on isActive from call logs
 * This function runs automatically in the background to keep campaign status in sync
 */
async function updateCallStatusFromLogs(campaignId, uniqueId) {
  try {
    const Campaign = require('../models/Campaign');
    const CallLog = require('../models/CallLog');
    
    // Find the campaign
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      console.log(`❌ Campaign ${campaignId} not found`);
      return null;
    }
    
    // Find the call detail
    const callDetail = campaign.details.find(d => d.uniqueId === uniqueId);
    if (!callDetail) {
      console.log(`❌ Call detail with uniqueId ${uniqueId} not found in campaign ${campaignId}`);
      return null;
    }
    
    // Find the call log for this uniqueId
    const callLog = await CallLog.findOne({ 
      'metadata.customParams.uniqueid': uniqueId 
    }).sort({ createdAt: -1 }); // Get the most recent log
    
    console.log(`🔍 Checking call ${uniqueId}: CallLog found = ${!!callLog}`);
    
    if (!callLog) {
      // No call log found - check if 45 seconds have passed since call initiation
      const timeSinceInitiation = Math.floor((new Date() - callDetail.time) / 1000);
      
      console.log(`⏰ Call ${uniqueId}: No CallLog found, ${timeSinceInitiation}s since initiation`);
      
      if (timeSinceInitiation >= 45) {
        // No call log for 45+ seconds, mark as completed (not connected)
        if (callDetail.status !== 'completed') {
          callDetail.status = 'completed';
          callDetail.lastStatusUpdate = new Date();
          callDetail.callDuration = timeSinceInitiation;
          await campaign.save();
          return 'completed';
        }
      } else {
        // Still within 40 seconds, keep as ringing
        console.log(`⏳ Call ${uniqueId} still ringing (${timeSinceInitiation}s since initiation)`);
        return null;
      }
      return null;
    }
    
    // Call log found - check isActive status
    const isActive = callLog.metadata?.isActive;
    const timeSinceCallStart = Math.floor((new Date() - callDetail.time) / 1000);
    
    console.log(`📞 Call ${uniqueId}: CallLog found, isActive = ${isActive}, current status = ${callDetail.status}, time since start = ${timeSinceCallStart}s`);
    
    // ENHANCED STATUS LOGIC: Check isActive and add timeout mechanism
    let newStatus;
    
    if (isActive === true) {
      // Call is active - check if it's been too long (5 minutes = 300 seconds)
      if (timeSinceCallStart >= 300) {
        // Call has been "active" for too long, mark as completed
        newStatus = 'completed';
        console.log(`🔄 Call ${uniqueId}: isActive=true but ${timeSinceCallStart}s passed, marking as completed (timeout)`);
        
        // Also update the CallLog to mark it as inactive
        try {
          await CallLog.findByIdAndUpdate(callLog._id, {
            'metadata.isActive': false,
            'metadata.callEndTime': new Date(),
            leadStatus: 'not_connected'
          });
        } catch (error) {
          console.error(`❌ Error updating CallLog:`, error);
        }
      } else {
        // Call is active and within reasonable time, keep as ongoing
        newStatus = 'ongoing';
      }
    } else if (isActive === false) {
      // Call is not active - mark as completed
      newStatus = 'completed';
    } else {
      // isActive is undefined/null - check if 45 seconds passed
      if (timeSinceCallStart >= 45) {
        newStatus = 'completed';
      } else {
        // Still within 40 seconds, keep current status
        return null;
      }
    }

    // Update campaign details with new status
    if (callDetail.status !== newStatus) {
      callDetail.status = newStatus;
      callDetail.lastStatusUpdate = new Date();
      
      // Calculate call duration if call ended
      if (newStatus === 'completed') {
        callDetail.callDuration = timeSinceCallStart;
        // Deduct credits for the call
        try {
          const { deductCreditsForCall } = require('./creditUsageService');
          const clientId = campaign.clientId || callLog?.clientId;
          const uniqueId = callDetail.uniqueId;
          if (clientId && uniqueId) {
            await deductCreditsForCall({ clientId, uniqueId });
          }
        } catch (e) {
          console.error('Credit deduction failed:', e.message);
        }
      }
      
      await campaign.save();
      
      return {
        uniqueId,
        oldStatus: callDetail.status,
        newStatus,
        isActive,
        leadStatus: callLog.leadStatus,
        timeSinceCallStart
      };
    }

    return null;
  } catch (error) {
    console.error('Error updating call status from logs:', error);
    return null;
  }
}

// In-memory storage for campaign calling progress
const campaignCallingProgress = new Map();
const activeCampaigns = new Map();

// AUTOMATIC: Background service to monitor and update call statuses
let statusUpdateInterval = null;

/**
 * Start automatic background status updates for all campaigns
 */
function startAutomaticStatusUpdates() {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
  }
  
  // Check and update call statuses every 3 seconds
  statusUpdateInterval = setInterval(async () => {
    try {
      await updateAllCampaignCallStatuses();
    } catch (error) {
      console.error('❌ Error in automatic status update:', error);
    }
  }, 3000); // 3 seconds
  
}

/**
 * Stop automatic background status updates
 */
function stopAutomaticStatusUpdates() {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
  }
}

/**
 * AUTOMATIC: Update call statuses for all campaigns based on isActive
 */
async function updateAllCampaignCallStatuses() {
  try {
    const Campaign = require('../models/Campaign');
    const CallLog = require('../models/CallLog');
    
    // Find all campaigns with ringing or ongoing calls
    const campaigns = await Campaign.find({
      'details.status': { $in: ['ringing', 'ongoing'] }
    }).lean();
    
    if (campaigns.length === 0) {
      return;
    }
    
    
    // Silent: avoid noisy logging of all campaigns
    
    let totalUpdates = 0;
    
    for (const campaign of campaigns) {
      const activeCalls = campaign.details.filter(d => d.status === 'ringing' || d.status === 'ongoing');
      
      for (const callDetail of activeCalls) {
        try {
          // Use the same logic as updateCallStatusFromLogs
          const updateResult = await updateCallStatusFromLogs(campaign._id, callDetail.uniqueId);
          if (updateResult) {
            totalUpdates++;
          }
        } catch (error) {
          console.error(`❌ Error updating call ${callDetail.uniqueId} in campaign ${campaign._id}:`, error);
        }
      }
    }
    
    // Suppress routine logs
    
  } catch (error) {
    console.error('❌ Error in updateAllCampaignCallStatuses:', error);
  }
}

/**
 * MANUAL: Trigger immediate status update for testing/debugging
 */
async function triggerManualStatusUpdate(campaignId = null) {
  try {
    console.log('🔧 MANUAL: Triggering immediate status update...');
    
    if (campaignId) {
      // Update specific campaign
      const Campaign = require('../models/Campaign');
      const campaign = await Campaign.findById(campaignId);
      if (campaign) {
        const activeCalls = campaign.details.filter(d => d.status === 'ringing' || d.status === 'ongoing');
        console.log(`🔧 MANUAL: Found ${activeCalls.length} active calls in campaign ${campaignId}`);
        
        for (const callDetail of activeCalls) {
          await updateCallStatusFromLogs(campaignId, callDetail.uniqueId);
        }
      }
    } else {
      // Update all campaigns
      await updateAllCampaignCallStatuses();
    }
    
    console.log('🔧 MANUAL: Status update completed');
  } catch (error) {
    console.error('❌ Error in manual status update:', error);
  }
}

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
  const uniqueId = generateUniqueId(); // Generate uniqueId at the start for both success and failure cases
  
  try {
    
    const callPayload = {
      transaction_id: "CTI_BOT_DIAL",
      phone_num: contact.phone.replace(/[^\d]/g, ""),
      uniqueid: uniqueId,
      callerid: "168353225",
      uuid: clientId || "client-uuid-001",
      custom_param: {
        uniqueid: uniqueId,
        name: contact.name || ''
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

    return {
      success: true,
      uniqueId,
      contact,
      timestamp: new Date(),
      externalResponse: response.data
    };

  } catch (error) {
    console.error('Error making single call:', error);
    
    return {
      success: false,
      uniqueId, // Return uniqueId even for failed calls
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
        
        break;
      }

      // Update progress
      progress.currentIndex = i;
      campaignCallingProgress.set(campaignId, progress);

      const contact = campaign.contacts[i];
      

      // Make the call
      const callResult = await makeSingleCall(contact, agentId, apiKey, campaign._id, clientId);
      
      // Update progress
      progress.completedCalls++;
      progress.lastCallTime = new Date();
      
      if (callResult.success) {
        progress.successfulCalls++;
        
        // Add call details to campaign with new structure
        if (callResult.uniqueId) {
          const initiatedAt = new Date();
          const callDetail = {
            uniqueId: callResult.uniqueId,
            contactId: contact._id || null,
            time: initiatedAt,
            status: 'ringing', // Start with 'ringing' status when call is initiated
            lastStatusUpdate: initiatedAt,
            callDuration: 0
          };
          
          // Check if this uniqueId already exists to avoid duplicates
          const existingDetail = campaign.details.find(d => d.uniqueId === callResult.uniqueId);
          if (!existingDetail) {
            campaign.details.push(callDetail);
            await campaign.save();
            
          }
          // Schedule a status check after ~40s to mirror frontend behavior
          setTimeout(() => {
            updateCallStatusFromLogs(campaign._id, callResult.uniqueId).catch(() => {});
          }, 40000);
        }
        // Do not wait for call to complete; proceed to next number immediately
      } else {
        progress.failedCalls++;
        
        // Do not add a Campaign.details entry on failed send (schema allows only ringing/ongoing/completed)
        // We already logged a CallLog with status 'failed'
        
      }

      campaignCallingProgress.set(campaignId, progress);

      // Wait before next call (except for last call)
      if (i < campaign.contacts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
      }
    }

    // Campaign completed
    
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
    }
  }
}

// Clean up completed campaigns every hour
setInterval(cleanupCompletedCampaigns, 60 * 60 * 1000);

// Clean up stale active calls every 10 minutes
setInterval(cleanupStaleActiveCalls, 10 * 60 * 1000);

/**
 * DEBUG: Check current call status for a specific uniqueId
 */
async function debugCallStatus(uniqueId) {
  try {
    const CallLog = require('../models/CallLog');
    
    // Find the most recent call log for this uniqueId
    const callLog = await CallLog.findOne(
      { 'metadata.customParams.uniqueid': uniqueId },
      {},
      { sort: { updatedAt: -1 } }
    ).lean();

    if (!callLog) {
      return null;
    }

    const isActive = callLog.metadata?.isActive;
    const leadStatus = callLog.leadStatus;
    const createdAt = callLog.createdAt;
    const callDuration = Math.floor((new Date() - createdAt) / 1000);
    
    // Determine expected status based on SIMPLE logic
    let expectedStatus = 'ringing';
    if (isActive === true) {
      expectedStatus = 'ongoing';
    } else if (isActive === false) {
      expectedStatus = 'completed';
    } else {
      // isActive is undefined/null - check if 40 seconds passed
      if (callDuration >= 40) {
        expectedStatus = 'completed';
      }
    }
    
    
    
    return {
      uniqueId,
      isActive,
      leadStatus,
      createdAt,
      callDuration,
      expectedStatus,
      shouldMarkAsCompleted: callDuration >= 40
    };
  } catch (error) {
    console.error('❌ Error in debug call status:', error);
    return null;
  }
}

/**
 * MANUAL: Fix stuck calls that have been "active" for too long
 */
async function fixStuckCalls() {
  try {
    const CallLog = require('../models/CallLog');
    const Campaign = require('../models/Campaign');
    
    
    // Find all CallLogs that have been "active" for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuckCallLogs = await CallLog.find({
      'metadata.isActive': true,
      createdAt: { $lt: fiveMinutesAgo }
    }).lean();
    
    
    for (const callLog of stuckCallLogs) {
      const uniqueId = callLog.metadata?.customParams?.uniqueid;
      if (!uniqueId) continue;
      
      
      // Update CallLog to mark as inactive
      await CallLog.findByIdAndUpdate(callLog._id, {
        'metadata.isActive': false,
        'metadata.callEndTime': new Date(),
        leadStatus: 'not_connected'
      });
      
      // Find and update campaign details
      const campaigns = await Campaign.find({
        'details.uniqueId': uniqueId
      });
      
      for (const campaign of campaigns) {
        const callDetail = campaign.details.find(d => d.uniqueId === uniqueId);
        if (callDetail && callDetail.status !== 'completed') {
          callDetail.status = 'completed';
          callDetail.lastStatusUpdate = new Date();
          callDetail.callDuration = Math.floor((new Date() - callDetail.time) / 1000);
          await campaign.save();
          console.log(`✅ MANUAL: Updated campaign ${campaign._id} call ${uniqueId} to completed`);
        }
      }
    }    
  } catch (error) {
    console.error('❌ Error fixing stuck calls:', error);
  }
}

/**
 * AUTOMATIC: Cleanup stale active calls (runs every 10 minutes)
 */
async function cleanupStaleActiveCalls() {
  try {
    const CallLog = require('../models/CallLog');
    
    
    
    // Find all CallLogs that have been "active" for more than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const staleCallLogs = await CallLog.find({
      'metadata.isActive': true,
      createdAt: { $lt: tenMinutesAgo }
    });
    
    if (staleCallLogs.length === 0) {
      return;
    }
    
    
    
    // Update all stale calls to inactive
    const updateResult = await CallLog.updateMany(
      {
        'metadata.isActive': true,
        createdAt: { $lt: tenMinutesAgo }
      },
      {
        $set: {
          'metadata.isActive': false,
          'metadata.callEndTime': new Date(),
          leadStatus: 'not_connected'
        }
      }
    );
    
    
    
  } catch (error) {
    console.error('❌ Error cleaning up stale active calls:', error);
  }
}

module.exports = {
  getClientApiKey,
  makeSingleCall,
  startCampaignCalling,
  stopCampaignCalling,
  getCampaignCallingProgress,
  getActiveCampaigns,
  cleanupCompletedCampaigns,
  updateCallStatusFromLogs,
  startAutomaticStatusUpdates,
  stopAutomaticStatusUpdates,
  updateAllCampaignCallStatuses,
  triggerManualStatusUpdate,
  debugCallStatus,
  migrateMissedToCompleted,
  fixStuckCalls,
  cleanupStaleActiveCalls
};

/**
 * MIGRATION: Convert any existing 'missed' status to 'completed'
 */
async function migrateMissedToCompleted() {
  try {
    const Campaign = require('../models/Campaign');
    
    // Find all campaigns with 'missed' status
    const campaignsWithMissed = await Campaign.find({
      'details.status': 'missed'
    });
    
    if (campaignsWithMissed.length === 0) {
      return;
    }
    
    console.log(`🔄 MIGRATION: Found ${campaignsWithMissed.length} campaigns with "missed" status, converting to "completed"...`);
    
    let totalConverted = 0;
    
    for (const campaign of campaignsWithMissed) {
      const missedDetails = campaign.details.filter(d => d.status === 'missed');
      
      for (const detail of missedDetails) {
        detail.status = 'completed';
        detail.lastStatusUpdate = new Date();
        // Calculate call duration
        detail.callDuration = Math.floor((new Date() - detail.time) / 1000);
        totalConverted++;
      }
      
      await campaign.save();
      console.log(`✅ MIGRATION: Converted ${missedDetails.length} "missed" calls to "completed" in campaign ${campaign._id}`);
    }
    
    console.log(`✅ MIGRATION: Completed! Converted ${totalConverted} total calls from "missed" to "completed"`);
    
  } catch (error) {
    console.error('❌ MIGRATION: Error converting missed to completed:', error);
  }
}

// AUTOMATIC: Start the background status update service after all functions are defined
console.log('🚀 Starting automatic campaign call status update service...');

// Run migrations first, then fix stuck calls, then start automatic updates
migrateMissedToCompleted().then(() => {
  return fixStuckCalls();
}).then(() => {
  // Run campaign validation fix
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('node scripts/fixCampaignValidation.js', (error, stdout, stderr) => {
      if (error) {
        console.log('⚠️ Campaign validation fix failed:', error.message);
      } else {
      }
      resolve();
    });
  });
}).then(() => {
  startAutomaticStatusUpdates();
});
