const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const axios = require('axios');
const http = require('http');
const VoiceChatWebSocketServer = require('./websocketServer');
const superadminRoutes = require('./routes/superadminroutes')
const adminRoutes = require('./routes/adminroutes');
const clientRoutes = require('./routes/clientroutes')
const profileRoutes = require('./routes/profileroutes')
const Business = require('./models/MyBussiness');

const app = express();
const server = http.createServer(app);
// Cashfree callback (return_url handler)
app.get('/api/v1/cashfree/callback', async (req, res) => {
  try {
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const SUCCESS_PATH = process.env.PAYMENT_SUCCESS_PATH || '/auth/dashboard';
    const { order_id, order_token } = req.query || {};
    if (!order_id) return res.redirect(`${FRONTEND_URL}${SUCCESS_PATH}?status=FAILED`);

    // Verify payment status with Cashfree
    const { BASE_URL, CLIENT_ID, CLIENT_SECRET } = require('./config/cashfree');
    const axios = require('axios');
    const headers = {
      'x-client-id': CLIENT_ID,
      'x-client-secret': CLIENT_SECRET,
      'x-api-version': '2022-09-01'
    };
    let status = 'FAILED';
    let transactionId = undefined;
    try {
      const resp = await axios.get(`${BASE_URL}/pg/orders/${order_id}`, { headers });
      const data = resp.data || {};
      status = (data.order_status === 'PAID') ? 'SUCCESS' : data.order_status || 'FAILED';
      transactionId = data.cf_payment_id || data.reference_id;
    } catch (e) {
      console.error('Cashfree status fetch failed:', e.message);
    }

    // Update payment record
    let paymentDoc = null;
    try {
      const Payment = require('./models/Payment');
      paymentDoc = await Payment.findOneAndUpdate(
        { orderId: order_id },
        { status, transactionId, rawCallback: req.query },
        { new: true }
      );
    } catch (e) {
      console.error('Payment update failed:', e.message);
    }

    // Auto-credit if success
    if (paymentDoc && status === 'SUCCESS' && !paymentDoc.credited) {
      try {
        const Credit = require('./models/Credit');
        const mapping = { basic: 1000, professional: 5500, enterprise: 11000 };
        const key = (paymentDoc.planKey || '').toLowerCase();
        const creditsToAdd = mapping[key] || 0;
        if (creditsToAdd > 0 && paymentDoc.clientId) {
          const creditRecord = await Credit.getOrCreateCreditRecord(paymentDoc.clientId);
          await creditRecord.addCredits(creditsToAdd, 'purchase', `Cashfree order ${order_id} • ${key} plan`, {
            gateway: 'cashfree', orderId: order_id, transactionId
          });
          const Payment = require('./models/Payment');
          await Payment.findOneAndUpdate({ orderId: order_id }, { credited: true, creditsAdded: creditsToAdd });
        }
      } catch (e) {
        console.error('Auto-credit on Cashfree failed:', e.message);
      }
    }

    return res.redirect(`${FRONTEND_URL}${SUCCESS_PATH}?orderId=${encodeURIComponent(order_id)}&status=${encodeURIComponent(status)}`);
  } catch (e) {
    console.error('Cashfree callback error:', e.message);
    res.status(200).send('OK');
  }
});

dotenv.config();

// Increase payload size limit to handle audio data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());

// Initialize WebSocket server
const wsServer = new VoiceChatWebSocketServer(server);

app.get('/', (req,res)=>{
    res.send("hello world")
})

// WebSocket server status endpoint
app.get('/ws/status', (req, res) => {
    const status = wsServer.getConnectionInfo();
    res.json({
        success: true,
        data: status
    });
});

// Paytm callback handler - redirects to frontend with orderId/status
app.post('/api/v1/paytm/callback', async (req, res) => {
  try {
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const SUCCESS_PATH = process.env.PAYMENT_SUCCESS_PATH || '/auth/dashboard';
    const body = req.body || {};
    const orderId = body.ORDERID || body.orderId || '';
    const status = body.STATUS || body.status || 'SUCCESS';
    let paymentDoc = null;
    try {
      const Payment = require('./models/Payment');
      paymentDoc = await Payment.findOneAndUpdate(
        { orderId },
        {
          status: (status === 'TXN_SUCCESS' || status === 'SUCCESS') ? 'SUCCESS' : (status || 'FAILED'),
          transactionId: body.TXNID || body.transactionId,
          responseCode: body.RESPCODE || body.responseCode,
          responseMsg: body.RESPMSG || body.responseMsg,
          rawCallback: body,
        },
        { new: true }
      );
    } catch (e) {
      console.error('Failed to upsert Payment from callback:', e.message);
    }

    // Auto-credit on SUCCESS
    if (paymentDoc && (paymentDoc.status === 'TXN_SUCCESS' || paymentDoc.status === 'SUCCESS' || status === 'TXN_SUCCESS' || status === 'SUCCESS')) {
      try {
        if (!paymentDoc.credited) {
          const Credit = require('./models/Credit');
          const mapping = {
            basic: 1000,
            professional: 5500,
            enterprise: 11000,
          };
          const key = (paymentDoc.planKey || '').toLowerCase();
          const creditsToAdd = mapping[key] || 0;
          if (creditsToAdd > 0 && paymentDoc.clientId) {
            const creditRecord = await Credit.getOrCreateCreditRecord(paymentDoc.clientId);
            // Idempotent by using orderId as transactionId in history if your addCredits supports metadata
            await creditRecord.addCredits(creditsToAdd, 'purchase', `Paytm order ${orderId} • ${key} plan`, {
              gateway: 'paytm',
              orderId,
              transactionId: body.TXNID || paymentDoc.transactionId,
            });
            const Payment = require('./models/Payment');
            await Payment.findOneAndUpdate(
              { orderId },
              { credited: true, creditsAdded: creditsToAdd }
            );
          }
        }
      } catch (e) {
        console.error('Auto-credit after callback failed:', e.message);
      }
    }
    const redirect = `${FRONTEND_URL}${SUCCESS_PATH}?orderId=${encodeURIComponent(orderId)}&status=${encodeURIComponent(status)}`;
    return res.redirect(302, redirect);
  } catch (e) {
    console.error('Paytm callback error:', e.message);
    res.status(200).send('OK');
  }
});

// Call Logs APIs
app.get("/api/v1/logs", async (req, res) => {
  try {
    const {
      clientId,
      limit = 50,
      page = 1,
      leadStatus,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      customField,
      customValue,
      customContains,
      uniqueid,
      mobile,
      agentId,
    } = req.query;

    const filters = {};
    if (clientId) filters.clientId = clientId;
    if (leadStatus) filters.leadStatus = leadStatus;
    if (typeof isActive !== 'undefined') filters['metadata.isActive'] = isActive === 'true';
    if (mobile) filters.mobile = mobile;
    if (agentId) filters.agentId = agentId;
    if (uniqueid) filters['metadata.customParams.uniqueid'] = uniqueid;

    if (customField && (customValue || customContains)) {
      const path = `metadata.customParams.${customField}`;
      if (customContains) {
        filters[path] = { $regex: customContains, $options: 'i' };
      } else {
        filters[path] = customValue;
      }
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const CallLog = require("./models/CallLog");

    const [logs, totalCount, activeCount, clientIds] = await Promise.all([
      CallLog.find(filters).sort(sort).limit(parseInt(limit)).skip(skip).lean().exec(),
      CallLog.countDocuments(filters),
      CallLog.countDocuments({ ...filters, 'metadata.isActive': true }),
      CallLog.distinct('clientId', {})
    ]);

    const response = {
      logs,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
      stats: {
        total: totalCount,
        active: activeCount,
        clients: clientIds.length,
        timestamp: new Date().toISOString(),
      },
      filters: {
        clientId,
        leadStatus,
        isActive,
        customField,
        customValue,
        customContains,
        uniqueid,
        mobile,
        agentId,
        availableClients: clientIds.sort(),
      }
    };

    res.json(response);
  } catch (error) {
    console.error("❌ [LOGS-API] Error fetching logs:", error.message);
    res.status(500).json({
      error: "Failed to fetch logs",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get most recent active call log for quick polling
app.get('/api/v1/logs/active', async (req, res) => {
  try {
    const { clientId, mobile, agentId, limit = 1 } = req.query;
    const CallLog = require('./models/CallLog');

    const filters = { 'metadata.isActive': true };
    if (clientId) filters.clientId = clientId;
    if (mobile) filters.mobile = mobile;
    if (agentId) filters.agentId = agentId;

    const logs = await CallLog.find(filters)
      .sort({ 'metadata.lastUpdated': -1 })
      .limit(parseInt(limit))
      .lean()
      .exec();

    res.json({ logs, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ [LOGS-ACTIVE] Error fetching active logs:', error.message);
    res.status(500).json({ error: 'Failed to fetch active logs', message: error.message });
  }
});

// Get specific call log by ID
app.get("/api/v1/logs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const CallLog = require("./models/CallLog");
    const log = await CallLog.findById(id).lean();
    if (!log) {
      return res.status(404).json({
        error: "Call log not found",
        id: id,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ log, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("❌ [LOGS-API] Error fetching log:", error.message);
    res.status(500).json({
      error: "Failed to fetch log",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get live statistic
app.get("/api/v1/logs/stats", async (req, res) => {
  try {
    const CallLog = require("./models/CallLog");
    const [totalCalls, activeCalls, todaysCalls, statusBreakdown, clientBreakdown] = await Promise.all([
      CallLog.countDocuments(),
      CallLog.countDocuments({ 'metadata.isActive': true }),
      CallLog.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
      CallLog.aggregate([{ $group: { _id: "$leadStatus", count: { $sum: 1 } } }]),
      CallLog.aggregate([
        { $group: { _id: "$clientId", count: { $sum: 1 }, activeCalls: { $sum: { $cond: ["$metadata.isActive", 1, 0] } } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    const wsStatus = wsServer.getConnectionInfo ? wsServer.getConnectionInfo() : {};

    const stats = {
      overview: {
        total: totalCalls,
        active: activeCalls,
        today: todaysCalls,
        timestamp: new Date().toISOString(),
      },
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      topClients: clientBreakdown,
      server: wsStatus,
    };

    res.json(stats);
  } catch (error) {
    console.error("❌ [LOGS-STATS] Error generating stats:", error.message);
    res.status(500).json({
      error: "Failed to generate statistics",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Clean up stale active calls (utility endpoint)
app.post("/api/v1/logs/cleanup", async (req, res) => {
  try {
    const CallLog = require("./models/CallLog");
    const result = await CallLog.cleanupStaleActiveCalls();
    res.json({ message: "Cleanup completed", modifiedCount: result.modifiedCount, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("❌ [LOGS-CLEANUP] Error during cleanup:", error.message);
    res.status(500).json({
      error: "Failed to cleanup stale calls",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/v1/client/proxy/clicktobot', async (req, res) => {
    try {
      const { apiKey, payload } = req.body;
      console.log(req.body)
      
      const response = await axios.post(
        'https://3neysomt18.execute-api.us-east-1.amazonaws.com/dev/clicktobot',
        payload,
        {
          headers: {
            'X-CLIENT': 'czobd',
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
        }
      );
  
      res.json({
        success: true,
        data: response.data
      });
    } catch (error) {
      console.error('Proxy error:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  });

app.use('/api/v1/superadmin',superadminRoutes);
app.use('/api/v1/admin',adminRoutes);
app.use('/api/v1/client',clientRoutes);
app.use('/api/v1/auth/client/profile', profileRoutes);

// Public API endpoint for business details (no authentication required)
app.get('/api/v1/public/business/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Check if identifier is a hash (8 characters) or ObjectId (24 characters)
    const isHash = /^[a-f0-9]{8}$/.test(identifier);
    const isObjectId = /^[a-f0-9]{24}$/.test(identifier);
    
    if (!isHash && !isObjectId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid business identifier format'
      });
    }

    // Find business by hash or ObjectId
    let business;
    if (isHash) {
      business = await Business.findOne({ hash: identifier });
    } else {
      business = await Business.findById(identifier);
    }
    
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Generate fresh URLs for images using getobject
    const { getobject } = require('./utils/s3');
    let imageWithUrl = business.image;
    let documentsWithUrl = business.documents;

    try {
      // Generate fresh URL for image
      if (business.image && business.image.key) {
        const imageUrl = await getobject(business.image.key);
        imageWithUrl = { ...business.image, url: imageUrl };
      }
      
      // Generate fresh URL for documents if provided
      if (business.documents && business.documents.key) {
        const documentsUrl = await getobject(business.documents.key);
        documentsWithUrl = { ...business.documents, url: documentsUrl };
      }
    } catch (s3Error) {
      console.error('Error generating S3 URLs:', s3Error);
      // Keep original URLs if S3 fails
      imageWithUrl = business.image;
      documentsWithUrl = business.documents;
    }

    // Return business details (excluding sensitive information)
    res.json({
      success: true,
      data: {
        _id: business._id,
        title: business.title,
        category: business.category,
        type: business.type,
        image: imageWithUrl,
        documents: documentsWithUrl,
        videoLink: business.videoLink,
        link: business.link,
        description: business.description,
        mrp: business.mrp,
        offerPrice: business.offerPrice,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching public business details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Manual fix stuck calls endpoint (for debugging)
app.post("/api/v1/debug/fix-stuck-calls", async (req, res) => {
  try {
    const { fixStuckCalls } = require('./services/campaignCallingService');
    await fixStuckCalls();
    res.json({ success: true, message: 'Stuck calls fixed successfully' });
  } catch (error) {
    console.error('❌ Error fixing stuck calls:', error);
    res.status(500).json({ error: 'Failed to fix stuck calls', message: error.message });
  }
});

// Manual fix specific stuck call endpoint (for debugging)
app.post("/api/v1/debug/fix-specific-call", async (req, res) => {
  try {
    const { uniqueId } = req.body;
    if (!uniqueId) {
      return res.status(400).json({ error: 'uniqueId is required' });
    }
    
    const CallLog = require('./models/CallLog');
    const Campaign = require('./models/Campaign');
    
    console.log(`🔧 MANUAL: Fixing specific stuck call: ${uniqueId}`);
    
    // Find the CallLog
    const callLog = await CallLog.findOne({
      'metadata.customParams.uniqueid': uniqueId
    });
    
    if (!callLog) {
      return res.status(404).json({ error: 'CallLog not found' });
    }
    
    // Update CallLog to mark as inactive
    await CallLog.findByIdAndUpdate(callLog._id, {
      'metadata.isActive': false,
      'metadata.callEndTime': new Date(),
      leadStatus: 'not_connected'
    });
    // Deduct credits for completed call if possible
    try {
      const { deductCreditsForCall } = require('./services/creditUsageService');
      const uniqueId = callLog?.metadata?.customParams?.uniqueid;
      const clientId = callLog?.clientId;
      if (clientId && uniqueId) {
        await deductCreditsForCall({ clientId, uniqueId });
      }
    } catch (e) {
      console.error('Credit deduction failed:', e.message);
    }
    
    // Find and update campaign details
    const campaigns = await Campaign.find({
      'details.uniqueId': uniqueId
    });
    
    let updatedCampaigns = 0;
    for (const campaign of campaigns) {
      const callDetail = campaign.details.find(d => d.uniqueId === uniqueId);
      if (callDetail && callDetail.status !== 'completed') {
        callDetail.status = 'completed';
        callDetail.lastStatusUpdate = new Date();
        callDetail.callDuration = Math.floor((new Date() - callDetail.time) / 1000);
        await campaign.save();
        updatedCampaigns++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `Fixed stuck call ${uniqueId}`,
      updatedCampaigns,
      callLogId: callLog._id
    });
    
  } catch (error) {
    console.error('❌ Error fixing specific stuck call:', error);
    res.status(500).json({ error: 'Failed to fix stuck call', message: error.message });
  }
});

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
        console.log(`🔌 WebSocket server is ready on ws://localhost:${PORT}`);
        console.log(`📊 WebSocket status: http://localhost:${PORT}/ws/status`);
    });
}).catch(err => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
});

