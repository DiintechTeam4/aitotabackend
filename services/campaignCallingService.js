const axios = require('axios');
const ApiKey = require('../models/ApiKey');
const Agent = require('../models/Agent');
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
        // No call log for 45+ seconds, mark as missed (not connected)
        if (callDetail.status !== 'completed') {
          const now = new Date();
          await Campaign.updateOne(
            { _id: campaignId, 'details.uniqueId': uniqueId },
            {
              $set: {
                'details.$.status': 'completed',
                'details.$.lastStatusUpdate': now,
                'details.$.callDuration': timeSinceInitiation,
                'details.$.leadStatus': 'not_connected'
              }
            }
          );
          console.log(`✅ Call ${uniqueId}: Marked as completed (no CallLog for ${timeSinceInitiation}s)`);
          return 'missed';
        } else {
          // Already completed, but log for debugging
          console.log(`✅ Call ${uniqueId}: Already completed (no CallLog for ${timeSinceInitiation}s)`);
          return 'already_completed';
        }
      } else {
        // Still within 45 seconds, keep as ringing
        console.log(`⏳ Call ${uniqueId} still ringing (${timeSinceInitiation}s since initiation)`);
        return null;
      }
    }
    
    // Call log found - check isActive status
    const isActive = callLog.metadata?.isActive;
    const timeSinceCallStart = Math.floor((new Date() - callDetail.time) / 1000);
    
    console.log(`📞 Call ${uniqueId}: CallLog found, isActive = ${isActive}, current status = ${callDetail.status}, time since start = ${timeSinceCallStart}s`);
    
    // ENHANCED STATUS LOGIC: Check isActive and add timeout mechanism
    let newStatus;
    
    if (isActive === true) {
      // Call is active - check if it's been too long (8 minutes = 480 seconds)
      if (timeSinceCallStart >= 480) {
        // Call has been "active" for too long, mark as completed
        newStatus = 'completed';
        console.log(`🔄 Call ${uniqueId}: isActive=true but ${timeSinceCallStart}s passed, marking as completed (8min timeout)`);
        
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
      const oldStatus = callDetail.status;
      const now = new Date();
      const setOps = {
        'details.$.status': newStatus,
        'details.$.lastStatusUpdate': now
      };
      if (newStatus === 'completed') {
        setOps['details.$.callDuration'] = timeSinceCallStart;
        try {
          const { deductCreditsForCall } = require('./creditUsageService');
          const clientId = campaign.clientId || callLog?.clientId;
          const uid = callDetail.uniqueId;
          if (clientId && uid) {
            await deductCreditsForCall({ clientId, uniqueId: uid });
          }
        } catch (e) {
          console.error('Credit deduction failed:', e.message);
        }
      }
      await Campaign.updateOne(
        { _id: campaignId, 'details.uniqueId': uniqueId },
        { $set: setOps }
      );
      // Optionally refresh minimal doc to recompute running status
      try {
        const refreshed = await Campaign.findById(campaignId).select('_id details isRunning updatedAt createdAt');
        await updateCampaignRunningStatus(refreshed);
      } catch {}
      return {
        uniqueId,
        oldStatus,
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

/**
 * Auto-update campaign isRunning field based on actual call status
 * This prevents campaigns from getting stuck in running state
 */
async function updateCampaignRunningStatus(campaign) {
  try {
    if (!campaign || !campaign.details) {
      return;
    }

    const details = Array.isArray(campaign.details) ? campaign.details : [];
    const hasActive = details.some(d => d && (d.status === 'ringing' || d.status === 'ongoing'));
    const initiatedCount = details.length;
    const completedCount = details.filter(d => d && d.status === 'completed').length;
    const allCallsFinalized = initiatedCount > 0 && !hasActive && completedCount === initiatedCount;

    let shouldUpdate = false;
    let newIsRunning = campaign.isRunning;

    // Check if campaign is waiting for calls to complete
    const progress = campaignCallingProgress.get(campaign._id.toString());
    const isWaitingForCalls = progress && progress.waitingForCallsToComplete;

    if (campaign.isRunning && allCallsFinalized) {
      // Campaign is marked as running but all calls are finalized - should be stopped
      newIsRunning = false;
      shouldUpdate = true;
      console.log(`🔄 Auto-stopping campaign ${campaign._id}: all calls finalized`);
      
      // FALLBACK: Schedule cleanup after 5 minutes for automatically stopped campaigns
      setTimeout(async () => {
        try {
          console.log('🧹 FALLBACK: Running cleanup after 5 minutes (auto-stop)...');
          await cleanupCompletedCampaignsWithDetails();
        } catch (error) {
          console.error('❌ FALLBACK: Error in 5-minute cleanup:', error);
        }
      }, 5 * 60 * 1000); // 5 minutes
    } else if (isWaitingForCalls && allCallsFinalized) {
      // Campaign was waiting for calls to complete and now all are done
      newIsRunning = false;
      shouldUpdate = true;
      console.log(`✅ Campaign ${campaign._id}: All calls completed, marking as finished`);
      
      // Clear the waiting flag
      if (progress) {
        progress.waitingForCallsToComplete = false;
        campaignCallingProgress.set(campaign._id.toString(), progress);
      }

      // Auto-save campaign run when all calls are completed after manual stop
      try {
        await autoSaveCampaignRun(campaign, progress);
        
        // MANUAL: Schedule cleanup after 5 minutes (only for manual stop)
        setTimeout(async () => {
          try {
            console.log('🧹 MANUAL: Running cleanup after 5 minutes...');
            await cleanupCompletedCampaignsWithDetails();
          } catch (error) {
            console.error('❌ MANUAL: Error in 5-minute cleanup:', error);
          }
        }, 5 * 60 * 1000); // 5 minutes
        
      } catch (error) {
        console.error(`❌ Error auto-saving campaign run for ${campaign._id}:`, error);
      }
    }

    if (shouldUpdate) {
      campaign.isRunning = newIsRunning;
      await campaign.save();
      console.log(`✅ Campaign ${campaign._id} isRunning updated to: ${newIsRunning}`);
    }
  } catch (error) {
    console.error('Error updating campaign running status:', error);
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
    
    // Filter out manually stopped campaigns (but still process campaigns waiting for calls to complete)
    const activeCampaignsList = campaigns.filter(campaign => {
      const progress = campaignCallingProgress.get(campaign._id.toString());
      // Process if not manually stopped OR if waiting for calls to complete
      return !progress || !progress.manuallyStopped || progress.waitingForCallsToComplete;
    });
    
    if (activeCampaignsList.length === 0) {
      return;
    }
    
    
    // Silent: avoid noisy logging of all campaigns
    
    let totalUpdates = 0;
    
    for (const campaign of activeCampaignsList) {
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
      
      // Also check and update campaign running status for each campaign
      try {
        const Campaign = require('../models/Campaign');
        const fullCampaign = await Campaign.findById(campaign._id);
        if (fullCampaign) {
          await updateCampaignRunningStatus(fullCampaign);
        }
      } catch (error) {
        console.error(`❌ Error updating running status for campaign ${campaign._id}:`, error);
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
async function makeSingleCall(contact, agentId, apiKey, campaignId, clientId, runId = null) {
  const uniqueId = generateUniqueId(); // Generate uniqueId at the start for both success and failure cases
  
  console.log(`📞 MAKING CALL: Contact=${contact?.phone}, AgentId=${agentId}, ApiKey=${!!apiKey}, ClientId=${clientId}`);
  
  try {
    // Load agent to branch by provider
    const agent = await Agent.findById(agentId).lean();
    const provider = String(agent?.serviceProvider || '').toLowerCase();

    // SANPBX provider flow
    if (provider === 'snapbx' || provider === 'sanpbx') {
      const accessToken = agent?.accessToken;
      const accessKey = agent?.accessKey;
      const callerId = agent?.callerId;
      if (!accessToken || !accessKey || !callerId) {
        throw new Error('Telephony_MISSING_FIELDS');
      }

      // Normalize phone and ensure it starts with '0'
      const normalizedDigits = String(contact?.phone || '').replace(/[^\d]/g, '');
      const callTo = normalizedDigits.startsWith('0') ? normalizedDigits : `0${normalizedDigits}`;

      // 1) Get API token (access token in header)
      const tokenUrl = 'https://clouduat28.sansoftwares.com/pbxadmin/sanpbxapi/gentoken';
      const tokenResp = await axios.post(tokenUrl, { access_key: accessKey }, { headers: { Accesstoken: accessToken }, timeout: 8000 });
      const sanToken = tokenResp?.data?.Apitoken;
      if (!sanToken) {
        throw new Error('SANPBX_TOKEN_FAILED');
      }

      // 2) Dial call (apitoken in header)
      const dialUrl = 'https://clouduat28.sansoftwares.com/pbxadmin/sanpbxapi/dialcall';
      const dialBody = { appid: 2, call_to: callTo, caller_id: callerId, custom_field: { uniqueid: uniqueId, name: contact.name , sanToken, runId } };
      const response = await axios.post(dialUrl, dialBody, { headers: { Apitoken: sanToken }, timeout: 10000 });

      return {
        success: true,
        uniqueId,
        contact,
        timestamp: new Date(),
        externalResponse: response.data,
        provider: 'sanpbx'
      };
    }

    // Check if API key is available
    if (!apiKey) {
      throw new Error('API_KEY_MISSING');
    }

    // Sanitize name and phone
    const rawName = (contact && contact.name) ? String(contact.name).trim() : '';
    const digitsOnly = (str) => (str || '').replace(/\D/g, '');
    const sanitizedPhone = digitsOnly(contact?.phone || '');
    if (!sanitizedPhone) {
      throw new Error('Missing phone');
    }
    
    console.log(`📞 CALL DETAILS: Phone=${sanitizedPhone}, Name=${rawName}, ApiKey=${apiKey.substring(0, 10)}...`);
    const isNumberLike = rawName && digitsOnly(rawName).length >= 6 && (
      !isNaN(Number(digitsOnly(rawName)))
    );
    const sameAsPhone = rawName && digitsOnly(rawName) === digitsOnly(contact.phone || '');
    const safeName = (rawName && !isNumberLike && !sameAsPhone) ? rawName : '';

    const callPayload = {
      transaction_id: "CTI_BOT_DIAL",
      phone_num: sanitizedPhone,
      uniqueid: uniqueId,
      callerid: "168353225",
      uuid: clientId || "client-uuid-001",
      custom_param: {
        uniqueid: uniqueId,
        name: safeName,
        contact_name: safeName,
        clientUserId: contact?.clientUserId || null,
        runId: runId
      },
      resFormat: 3,
    };

    // Make call to external API
    console.log(`📞 EXTERNAL API CALL: Sending to clicktobot API`);
    const response = await axios.post(
      'https://3neysomt18.execute-api.us-east-1.amazonaws.com/dev/clicktobot',
      callPayload,
      {
        headers: {
          'X-CLIENT': 'czobd',
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000 // 10 second timeout
      }
    );

    console.log(`✅ EXTERNAL API SUCCESS: Response status=${response.status}`);
    return {
      success: true,
      uniqueId,
      contact,
      timestamp: new Date(),
      externalResponse: response.data
    };

  } catch (error) {
    console.error('❌ CALL FAILED:', error?.response?.status, error?.response?.data || error?.message);
    
    // Create a CallLog entry for failed calls so they don't stay in "ringing" forever
    try {
      const CallLog = require('../models/CallLog');
      await CallLog.create({
        clientId: clientId,
        campaignId: campaignId,
        agentId: agentId,
        mobile: contact?.phone,
        time: new Date(),
        duration: 0,
        leadStatus: 'not_connected',
        callType: 'outbound',
        statusText: 'Failed',
        metadata: {
          customParams: {
            uniqueid: uniqueId,
            name: contact?.name || '',
            contact_name: contact?.name || '',
            runId: runId
          },
          isActive: false,
          callEndTime: new Date(),
          error: error.message
        }
      });
      console.log(`📝 CREATED FAILED CALL LOG for ${uniqueId}`);
    } catch (logError) {
      console.error('❌ Failed to create CallLog for failed call:', logError);
    }
    
    return {
      success: false,
      uniqueId, // Return uniqueId even for failed calls
      error: error.message,
      status: error?.response?.status || null,
      responseData: error?.response?.data || null,
      provider: 'czentrix',
      contact,
      timestamp: new Date()
    };
  }
}

/**
 * Start campaign calling process
 */
async function startCampaignCalling(campaign, agentId, apiKey, delayBetweenCalls, clientId, runId) {
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
    lastCallTime: null,
    runId: runId || `run-${Date.now()}` // Store runId for tracking
  };

  campaignCallingProgress.set(campaignId, progress);
  activeCampaigns.set(campaignId, true);

  

  // Process calls in background
  processCampaignCalls(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress, runId);
}

/**
 * Process campaign calls in background with batch processing
 */
async function processCampaignCalls(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress, runId) {
  const campaignId = campaign._id.toString();
  const BATCH_SIZE = parseInt(process.env.CAMPAIGN_BATCH_SIZE) || 100; // Process calls in batches (configurable via env)
  
  try {
    // Resume from where we left off if this is a continuation
    let startIndex = progress.currentIndex || 0;
    
    console.log(`🚀 BATCH PROCESSING: Starting from index ${startIndex}/${campaign.contacts.length}`);
    
    // Process in batches
    for (let batchStart = startIndex; batchStart < campaign.contacts.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, campaign.contacts.length);
      const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(campaign.contacts.length / BATCH_SIZE);
      
      console.log(`📦 BATCH ${batchNumber}/${totalBatches}: Processing calls ${batchStart + 1}-${batchEnd} of ${campaign.contacts.length}`);
      
      // Process this batch
      await processBatch(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress, runId, batchStart, batchEnd);
      
      // Update progress index to end of current batch
      progress.currentIndex = batchEnd;
      campaignCallingProgress.set(campaignId, progress);
      
      // Save progress after each batch
      await saveBatchProgress(campaign, progress, runId, batchNumber, totalBatches);
      
      // Check if campaign should continue
      const isActive = activeCampaigns.get(campaignId);
      if (!isActive) {
        console.log(`🛑 CAMPAIGN STOPPED: Campaign ${campaignId} removed from active campaigns after batch ${batchNumber}`);
        break;
      }
      
      const currentProgress = campaignCallingProgress.get(campaignId);
      if (currentProgress && currentProgress.manuallyStopped) {
        console.log(`🛑 MANUAL STOP DETECTED: Campaign ${campaignId} was manually stopped after batch ${batchNumber}`);
        break;
      }
      
      // Small delay between batches to prevent overwhelming the system
      if (batchEnd < campaign.contacts.length) {
        console.log(`⏳ BATCH COMPLETE: Waiting 2 seconds before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Final completion
    progress.isRunning = false;
    progress.endTime = new Date();
    progress.waitingForCallsToComplete = true;
    campaignCallingProgress.set(campaignId, progress);
    
    console.log(`✅ CAMPAIGN COMPLETED: All ${campaign.contacts.length} calls processed`);
    
  } catch (error) {
    console.error(`❌ Error in campaign calling process for ${campaignId}:`, error);
    progress.isRunning = false;
    progress.endTime = new Date();
    campaignCallingProgress.set(campaignId, progress);
  }
}

/**
 * Process a single batch of calls
 */
async function processBatch(campaign, agentId, apiKey, delayBetweenCalls, clientId, progress, runId, batchStart, batchEnd) {
  const campaignId = campaign._id.toString();
  
  try {
    for (let i = batchStart; i < batchEnd; i++) {
      // Check if campaign should stop (manual stop or removed from active campaigns)
      const isActive = activeCampaigns.get(campaignId);
      console.log(`🔄 PROCESS CALL ${i + 1}/${campaign.contacts.length}: activeCampaigns.get(${campaignId}) = ${isActive}`);
      
      if (!isActive) {
        console.log(`🛑 CAMPAIGN STOPPED: Campaign ${campaignId} removed from active campaigns, stopping at contact ${i + 1}/${campaign.contacts.length}`);
        break;
      }
      
      // Check if campaign was manually stopped
      const currentProgress = campaignCallingProgress.get(campaignId);
      console.log(`🔄 PROCESS CALL ${i + 1}/${campaign.contacts.length}: progress.manuallyStopped = ${currentProgress?.manuallyStopped}`);
      
      if (currentProgress && currentProgress.manuallyStopped) {
        console.log(`🛑 MANUAL STOP DETECTED: Campaign ${campaignId} was manually stopped, stopping at contact ${i + 1}/${campaign.contacts.length}`);
        break;
      }

      // Update progress
      progress.currentIndex = i;
      campaignCallingProgress.set(campaignId, progress);

      const contact = campaign.contacts[i];
      

      // Make the call
      console.log(`🔄 MAKING CALL ${i + 1}/${campaign.contacts.length}: ${contact.phone}`);
      const callResult = await makeSingleCall(contact, agentId, apiKey, campaign._id, clientId, runId);
      
      // Update progress
      progress.completedCalls++;
      progress.lastCallTime = new Date();
      
      if (callResult.success) {
        progress.successfulCalls++;
        console.log(`✅ CALL SUCCESS: ${callResult.uniqueId}`);
        
        // Add call details to campaign with new structure
        if (callResult.uniqueId) {
          const initiatedAt = new Date();
          const callDetail = {
            uniqueId: callResult.uniqueId,
            contactId: contact._id || null,
            time: initiatedAt,
            status: 'ringing', // Start with 'ringing' status when call is initiated
            lastStatusUpdate: initiatedAt,
            callDuration: 0,
            ...(runId ? { runId } : {})
          };
          
          // Atomically push if missing to avoid version conflicts
          const Campaign = require('../models/Campaign');
          await Campaign.updateOne(
            { _id: campaign._id, 'details.uniqueId': { $ne: callResult.uniqueId } },
            { $push: { details: callDetail } }
          );
          console.log(`📝 ADDED CALL DETAIL (atomic): ${callResult.uniqueId}`);
          // Schedule a status check after ~40s to mirror frontend behavior
          setTimeout(() => {
            updateCallStatusFromLogs(campaign._id, callResult.uniqueId).catch(() => {});
          }, 40000);
        }
        // Do not wait for call to complete; proceed to next number immediately
      } else {
        progress.failedCalls++;
        console.log(`❌ CALL FAILED: ${callResult.error}`);
        
        // Add failed call details to campaign so it shows up in the UI
        if (callResult.uniqueId) {
          const initiatedAt = new Date();
          const callDetail = {
            uniqueId: callResult.uniqueId,
            contactId: contact._id || null,
            time: initiatedAt,
            status: 'completed', // Mark failed calls as completed immediately
            lastStatusUpdate: initiatedAt,
            callDuration: 0,
            leadStatus: 'not_connected',
            ...(runId ? { runId } : {})
          };
          
          // Atomically push if missing to avoid version conflicts
          const Campaign = require('../models/Campaign');
          await Campaign.updateOne(
            { _id: campaign._id, 'details.uniqueId': { $ne: callResult.uniqueId } },
            { $push: { details: callDetail } }
          );
          console.log(`📝 ADDED FAILED CALL DETAIL (atomic): ${callResult.uniqueId}`);
        }
      }

      campaignCallingProgress.set(campaignId, progress);

      // Wait before next call (except for last call in batch)
      if (i < batchEnd - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
      }
    }
  } catch (error) {
    console.error(`❌ Error processing batch ${batchStart}-${batchEnd} for campaign ${campaignId}:`, error);
    throw error;
  }
}

/**
 * Save batch progress and create intermediate campaign history
 */
async function saveBatchProgress(campaign, progress, runId, batchNumber, totalBatches) {
  try {
    const campaignId = campaign._id.toString();
    const CampaignHistory = require('../models/CampaignHistory');
    
    console.log(`💾 SAVING BATCH ${batchNumber}/${totalBatches} PROGRESS (appending to run ${runId})...`);
    
    // Determine the slice of contacts for this batch (100 per batch)
    const batchStartIndex = (batchNumber - 1) * 100;
    const batchEndIndex = Math.min(batchStartIndex + 100, campaign.contacts.length);
    
    // Reload the latest campaign to get up-to-date details
    const Campaign = require('../models/Campaign');
    const updatedCampaign = await Campaign.findById(campaign._id);
    const campaignDetails = Array.isArray(updatedCampaign.details) ? updatedCampaign.details : [];
    
    // Filter details for this runId and take the slice for this batch
    const runDetails = campaignDetails.filter(d => d && d.uniqueId && d.runId === runId);
    const batchCallDetails = runDetails.slice(batchStartIndex, batchEndIndex);
    
    // Map contacts for this batch
    const contactsForBatch = batchCallDetails.map((detail, index) => {
      const contactIndex = batchStartIndex + index;
      const contact = (updatedCampaign.contacts || [])[contactIndex] || {};
      return {
        documentId: detail.uniqueId,
        number: contact.phone || contact.number || '',
        name: contact.name || '',
        leadStatus: detail.leadStatus || 'not_connected',
        contactId: detail.contactId || contact._id || '',
        time: detail.time || new Date().toISOString(),
        status: detail.status || 'completed',
        duration: detail.callDuration || 0,
        transcriptCount: 0,
        whatsappMessageSent: false,
        whatsappRequested: false
      };
    });
    
    const successfulInBatch = batchCallDetails.filter(d => (d.leadStatus || '').toLowerCase() === 'connected').length;
    const totalDurationInBatch = batchCallDetails.reduce((sum, d) => sum + (d.callDuration || 0), 0);
    const totalInBatch = contactsForBatch.length;
    const failedInBatch = totalInBatch - successfulInBatch;
    
    const now = new Date();
    const startDate = progress && progress.startTime instanceof Date ? progress.startTime : new Date(progress && progress.startTime || now);
    const elapsedSeconds = Math.max(0, Math.floor((now - startDate) / 1000));
    const toHms = (secs) => ({
      hours: Math.floor(secs / 3600),
      minutes: Math.floor((secs % 3600) / 60),
      seconds: secs % 60
    });
    
    // Ensure a single CampaignHistory per runId. Upsert and append contacts + stats.
    const existingHistory = await CampaignHistory.findOne({ runId }).lean();
    let instanceNumber = 1;
    if (!existingHistory) {
      const existingCount = await CampaignHistory.countDocuments({ campaignId });
      instanceNumber = existingCount + 1;
    }
    
    await CampaignHistory.findOneAndUpdate(
      { runId },
      {
        $setOnInsert: {
          campaignId: campaign._id,
          runId,
          instanceNumber,
          startTime: (startDate && startDate.toISOString) ? startDate.toISOString() : String(startDate),
          status: 'running',
          stats: {
            totalContacts: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalCallDuration: 0,
            averageCallDuration: 0
          },
          contacts: []
        },
        $set: {
          endTime: now.toISOString(),
          runTime: toHms(elapsedSeconds),
          updatedAt: now
        },
        $push: {
          contacts: { $each: contactsForBatch }
        },
        $inc: {
          'stats.totalContacts': totalInBatch,
          'stats.successfulCalls': successfulInBatch,
          'stats.failedCalls': failedInBatch,
          'stats.totalCallDuration': totalDurationInBatch
        }
      },
      { upsert: true, new: true }
    );
    
    // Optionally recompute averageCallDuration based on current totals
    const updatedHistory = await CampaignHistory.findOne({ runId }, { 'stats.totalContacts': 1, 'stats.totalCallDuration': 1 }).lean();
    if (updatedHistory && updatedHistory.stats) {
      const { totalContacts, totalCallDuration } = updatedHistory.stats;
      const avg = totalContacts > 0 ? Math.round(totalCallDuration / totalContacts) : 0;
      await CampaignHistory.updateOne(
        { runId },
        { $set: { 'stats.averageCallDuration': avg } }
      );
    }
    
    console.log(`✅ BATCH ${batchNumber}/${totalBatches} APPENDED: ${progress.completedCalls} calls processed (run ${runId})`);
    
    // Update progress in memory
    campaignCallingProgress.set(campaignId, progress);
    
  } catch (error) {
    console.error(`❌ Error saving batch ${batchNumber} progress:`, error);
    // Don't throw error to prevent stopping the campaign
  }
}

/**
 * Stop campaign calling process
 */
function stopCampaignCalling(campaignId) {
  
  // Remove from active campaigns to stop new calls
  activeCampaigns.delete(campaignId);
  
  const progress = campaignCallingProgress.get(campaignId);
  
  if (progress) {
    progress.isRunning = false;
    progress.endTime = new Date();
    progress.manuallyStopped = true; // Mark as manually stopped
    campaignCallingProgress.set(campaignId, progress);
    console.log(`✅ MANUAL STOP: Progress updated:`, {
      isRunning: progress.isRunning,
      manuallyStopped: progress.manuallyStopped,
      endTime: progress.endTime
    });
  } else {
    console.log(`⚠️ MANUAL STOP: No progress found for campaign ${campaignId}`);
  }
  
  // Note: Ongoing calls will continue until they naturally complete
  // The automatic status updates will handle marking them as completed
  // when their CallLog shows isActive: false
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
      // isActive is undefined/null - check if 60 seconds passed (increased from 40s)
      if (callDuration >= 60) {
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
      shouldMarkAsCompleted: callDuration >= 60
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
    
    
    // Find all CallLogs that have been "active" for more than 8 minutes
    const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000);
    const stuckCallLogs = await CallLog.find({
      'metadata.isActive': true,
      createdAt: { $lt: eightMinutesAgo }
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
          const now = new Date();
          await Campaign.updateOne(
            { _id: campaign._id, 'details.uniqueId': uniqueId },
            {
              $set: {
                'details.$.status': 'completed',
                'details.$.lastStatusUpdate': now,
                'details.$.callDuration': Math.floor((now - callDetail.time) / 1000)
              }
            }
          );
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
    
    
    
    // Find all CallLogs that have been "active" for more than 8 minutes
    const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000);
    const staleCallLogs = await CallLog.find({
      'metadata.isActive': true,
      createdAt: { $lt: eightMinutesAgo }
    });
    
    if (staleCallLogs.length === 0) {
      return;
    }
    
    
    
    // Update all stale calls to inactive
    const updateResult = await CallLog.updateMany(
      {
        'metadata.isActive': true,
        createdAt: { $lt: eightMinutesAgo }
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

/**
 * SERVER RESTART: Cleanup campaigns that might be stuck in running state
 */
async function cleanupStuckCampaignsOnRestart() {
  try {    
    const Campaign = require('../models/Campaign');
    
    // Find campaigns that are marked as running but have no active progress
    const stuckCampaigns = await Campaign.find({
      isRunning: true
    }).lean();
    
    if (stuckCampaigns.length === 0) {
      console.log('✅ SERVER RESTART: No stuck campaigns found');
      return;
    }
    
    console.log(`🔍 SERVER RESTART: Found ${stuckCampaigns.length} potentially stuck campaigns`);
    
    for (const campaign of stuckCampaigns) {
      const campaignId = campaign._id.toString();
      const progress = campaignCallingProgress.get(campaignId);
      
      // If no progress exists in memory, this campaign is likely stuck
      if (!progress) {
        console.log(`⚠️ SERVER RESTART: Campaign ${campaignId} is marked as running but has no progress - marking as stopped`);
        
        // Update campaign to not running
        await Campaign.findByIdAndUpdate(campaignId, {
          isRunning: false
        });
        
        // Remove from active campaigns if it exists
        activeCampaigns.delete(campaignId);
        
        console.log(`✅ SERVER RESTART: Campaign ${campaignId} marked as stopped`);
      } else {
        console.log(`ℹ️ SERVER RESTART: Campaign ${campaignId} has progress - leaving as is`);
      }
    }
    
    console.log('✅ SERVER RESTART: Stuck campaigns cleanup completed');
    
  } catch (error) {
    console.error('❌ SERVER RESTART: Error cleaning up stuck campaigns:', error);
  }
}

/**
 * SIMPLE: Cleanup completed campaigns with details (manual only)
 */
async function cleanupCompletedCampaignsWithDetails() {
  try {
    console.log('🧹 MANUAL: Checking for completed campaigns with details...');
    
    const Campaign = require('../models/Campaign');
    
    // Find campaigns that are not running but still have details
    const completedCampaignsWithDetails = await Campaign.find({
      isRunning: false,
      details: { $exists: true, $ne: [], $not: { $size: 0 } }
    }).lean();
    
    console.log(`🧹 MANUAL: Found ${completedCampaignsWithDetails.length} completed campaigns with details`);
    
    for (const campaign of completedCampaignsWithDetails) {
      try {
        console.log(`🧹 MANUAL: Processing completed campaign ${campaign._id} with ${campaign.details.length} details`);
        
        // Create progress object for auto-save
        const progress = {
          campaignId: campaign._id.toString(),
          totalContacts: campaign.contacts?.length || 0,
          currentIndex: campaign.details?.length || 0,
          completedCalls: campaign.details?.filter(d => d?.status === 'completed').length || 0,
          successfulCalls: 0,
          failedCalls: 0,
          startTime: new Date(campaign.updatedAt || campaign.createdAt),
          isRunning: false,
          endTime: new Date(),
          waitingForCallsToComplete: false,
          runId: `cleanup-${Date.now()}`,
          recovered: true
        };
        
        // Auto-save the campaign run
        const fullCampaign = await Campaign.findById(campaign._id);
        if (fullCampaign) {
          await autoSaveCampaignRun(fullCampaign, progress);
          console.log(`✅ MANUAL: Saved details for completed campaign ${campaign._id}`);
        }
        
      } catch (error) {
        console.error(`❌ MANUAL: Error processing completed campaign ${campaign._id}:`, error);
      }
    }
    
    console.log(`✅ MANUAL: Completed campaigns cleanup finished`);
  } catch (error) {
    console.error('❌ MANUAL: Error during completed campaigns cleanup:', error);
  }
}

/**
 * Auto-save campaign run when all calls are completed after manual stop
 */
async function autoSaveCampaignRun(campaign, progress) {
  try {
    if (!progress || !progress.startTime) {
      console.log(`⚠️ No progress or startTime found for campaign ${campaign._id}`);
      return;
    }

    const now = new Date();
    const startTime = progress.startTime;
    const endTime = now;
    const runTime = Math.floor((endTime - startTime) / 1000); // in seconds
    const runId = progress.runId || `run-${Date.now()}`;

    console.log(`💾 AUTO-SAVE: Saving campaign run for ${campaign._id}, runTime: ${runTime}s`);

    // Fetch call logs for this run
    const CallLog = require('../models/CallLog');
    const callLogs = await CallLog.find({
      campaignId: campaign._id,
      'metadata.customParams.runId': runId
    }).lean();

    console.log(`💾 AUTO-SAVE: Found ${callLogs.length} call logs for run ${runId}`);

    // Create campaign history entry
    const historyEntry = {
      runId,
      startTime,
      endTime,
      runTime,
      callLogs: callLogs.map(log => ({
        uniqueId: log.metadata?.customParams?.uniqueid,
        phone: log.mobile,
        duration: log.duration,
        leadStatus: log.leadStatus,
        statusText: log.statusText,
        time: log.time
      })),
      totalCalls: callLogs.length,
      successfulCalls: callLogs.filter(log => log.leadStatus && log.leadStatus !== 'not_connected').length,
      failedCalls: callLogs.filter(log => !log.leadStatus || log.leadStatus === 'not_connected').length
    };

    // Add to campaign history
    if (!campaign.history) {
      campaign.history = [];
    }
    campaign.history.push(historyEntry);
    await campaign.save();

    console.log(`✅ AUTO-SAVE: Campaign run saved successfully for ${campaign._id}`);
  } catch (error) {
    console.error(`❌ AUTO-SAVE: Error saving campaign run for ${campaign._id}:`, error);
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
  updateCampaignRunningStatus,
  startAutomaticStatusUpdates,
  stopAutomaticStatusUpdates,
  updateAllCampaignCallStatuses,
  triggerManualStatusUpdate,
  debugCallStatus,
  migrateMissedToCompleted,
  fixStuckCalls,
  cleanupStaleActiveCalls,
  cleanupStuckCampaignsOnRestart,
  saveBatchProgress,
  autoSaveCampaignRun,
  cleanupCompletedCampaignsWithDetails
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
