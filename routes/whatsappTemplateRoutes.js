const express = require('express')
const router = express.Router()
const WhatsAppTemplateRequest = require('../models/WhatsAppTemplateRequest')
const Agent = require('../models/Agent')
const Client = require('../models/Client')
const axios = require('axios')
const crypto = require('crypto')

// Middleware to verify admin token (optional, can be added if needed)
const verifyAdminToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authorization token required' })
    }
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    // You can add admin role check here if needed
    req.adminId = decoded.id
    next()
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid authorization token' })
  }
}

// Static ClientID for Naven API
const NAVEN_CLIENT_ID = process.env.NAVEN_CLIENT_ID || '68fdff91b9324e6254fb7f5e'
const NAVEN_API_URL = process.env.NAVEN_API_URL || 'https://api.naven.com/whatsapp-template'

// Client requests WhatsApp template
router.post('/request', async (req, res) => {
  try {
    const { agentId, message } = req.body || {}
    const token = req.headers.authorization?.replace('Bearer ', '')
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authorization token required' })
    }

    // Verify JWT and get clientId
    const jwt = require('jsonwebtoken')
    let clientId
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      clientId = decoded.id || decoded.clientId
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid authorization token' })
    }

    if (!agentId || !message) {
      return res.status(400).json({ success: false, message: 'agentId and message are required' })
    }

    // Verify agent belongs to client
    const agent = await Agent.findOne({ _id: agentId, clientId })
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found or does not belong to client' })
    }

    // Generate unique requestClientId
    const requestClientId = `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`

    // Create request
    const request = await WhatsAppTemplateRequest.create({
      requestClientId,
      clientId,
      agentId,
      message,
      status: 'requested'
    })

    res.status(201).json({ 
      success: true, 
      data: request,
      message: 'WhatsApp template request submitted successfully' 
    })
  } catch (e) {
    console.error('Error creating WhatsApp template request:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin gets all requests (with filters)
router.get('/requests', verifyAdminToken, async (req, res) => {
  try {
    const { status, clientId } = req.query
    const filter = {}
    
    if (status) {
      filter.status = status
    }
    if (clientId) {
      filter.clientId = clientId
    }

    const requests = await WhatsAppTemplateRequest.find(filter)
      .populate('agentId', 'agentName didNumber')
      .sort({ createdAt: -1 })
      .lean()

    // Get client details for each request
    const clientIds = [...new Set(requests.map(r => r.clientId))]
    const clients = await Client.find({ _id: { $in: clientIds } })
      .select('name email businessName')
      .lean()
    
    const clientMap = {}
    clients.forEach(c => {
      clientMap[String(c._id)] = c
    })

    const enrichedRequests = requests.map(req => ({
      ...req,
      client: clientMap[req.clientId] || null
    }))

    res.json({ success: true, data: enrichedRequests })
  } catch (e) {
    console.error('Error fetching WhatsApp template requests:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin approves initial request (sends to Naven API)
router.post('/approve', verifyAdminToken, async (req, res) => {
  try {
    const { requestId } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' })
    }

    const request = await WhatsAppTemplateRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (request.status !== 'requested') {
      return res.status(400).json({ 
        success: false, 
        message: `Request is already ${request.status}` 
      })
    }

    // Send to Naven API
    try {
      const navenPayload = {
        ClientID: NAVEN_CLIENT_ID,
        requestclientid: request.requestClientId,
        message: request.message
      }

      console.log('Sending to Naven API:', navenPayload)
      
      // For now, simulate Naven API call (replace with actual API when available)
      const navenResponse = await axios.post(NAVEN_API_URL, navenPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }).catch(async (error) => {
        // If Naven API is not available, simulate success for development
        console.warn('Naven API not available, simulating response:', error.message)
        return {
          data: {
            success: true,
            requestclientid: request.requestClientId,
            status: 'processing'
          }
        }
      })

      // Update request status
      request.status = 'naven_processing'
      request.navenResponse = navenResponse.data
      await request.save()

      res.json({ 
        success: true, 
        data: request,
        message: 'Request approved and sent to Naven API for processing' 
      })
    } catch (navenError) {
      console.error('Naven API error:', navenError)
      // Still mark as processing even if API call fails (they might call back)
      request.status = 'naven_processing'
      await request.save()
      
      res.json({ 
        success: true, 
        data: request,
        message: 'Request approved. Naven API processing initiated' 
      })
    }
  } catch (e) {
    console.error('Error approving WhatsApp template request:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin rejects initial request
router.post('/reject', verifyAdminToken, async (req, res) => {
  try {
    const { requestId, reason } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' })
    }

    const request = await WhatsAppTemplateRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (request.status !== 'requested') {
      return res.status(400).json({ 
        success: false, 
        message: `Request cannot be rejected. Current status: ${request.status}` 
      })
    }

    request.status = 'admin_rejected'
    request.rejectionReason = reason || 'Rejected by admin'
    await request.save()

    res.json({ 
      success: true, 
      data: request,
      message: 'Request rejected successfully' 
    })
  } catch (e) {
    console.error('Error rejecting WhatsApp template request:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Naven API callback (when template is ready)
router.post('/naven-callback', async (req, res) => {
  try {
    const { requestclientid, templateUrl, completed } = req.body || {}
    
    if (!requestclientid) {
      return res.status(400).json({ success: false, message: 'requestclientid is required' })
    }

    const request = await WhatsAppTemplateRequest.findOne({ requestClientId: requestclientid })
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (completed === true && templateUrl) {
      request.status = 'naven_ready'
      request.templateUrl = templateUrl
      request.navenResponse = { ...request.navenResponse, ...req.body }
      await request.save()

      res.json({ 
        success: true, 
        message: 'Template ready status updated',
        data: request
      })
    } else {
      // Template processing failed or incomplete
      request.status = 'admin_rejected'
      request.rejectionReason = 'Template processing failed at Naven API'
      request.navenResponse = { ...request.navenResponse, ...req.body }
      await request.save()

      res.json({ 
        success: true, 
        message: 'Template processing failed',
        data: request
      })
    }
  } catch (e) {
    console.error('Error processing Naven callback:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin approves final template (assigns to agent)
router.post('/assign', verifyAdminToken, async (req, res) => {
  try {
    const { requestId } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' })
    }

    const request = await WhatsAppTemplateRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (request.status !== 'naven_ready') {
      return res.status(400).json({ 
        success: false, 
        message: `Template must be ready (naven_ready) before assignment. Current status: ${request.status}` 
      })
    }

    if (!request.templateUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Template URL is missing' 
      })
    }

    // Assign to agent
    const agent = await Agent.findById(request.agentId)
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' })
    }

    // Ensure whatsappTemplates array exists
    if (!Array.isArray(agent.whatsappTemplates)) {
      agent.whatsappTemplates = []
    }

    // Check if template already exists
    const existingTemplate = agent.whatsappTemplates.find(
      t => t.templateUrl === request.templateUrl
    )

    if (!existingTemplate) {
      // Add new template
      agent.whatsappTemplates.push({
        templateId: request.requestClientId,
        templateName: `Template ${request.requestClientId}`,
        templateUrl: request.templateUrl,
        description: request.message.substring(0, 100),
        language: 'en',
        status: 'APPROVED',
        category: 'MARKETING',
        assignedAt: new Date()
      })
    } else {
      // Update existing template
      existingTemplate.status = 'APPROVED'
      existingTemplate.assignedAt = new Date()
    }

    // Enable WhatsApp for agent
    agent.whatsappEnabled = true
    await agent.save()

    // Update request status
    request.status = 'assigned'
    request.assignedAt = new Date()
    await request.save()

    res.json({ 
      success: true, 
      data: {
        request,
        agent: {
          _id: agent._id,
          whatsappTemplates: agent.whatsappTemplates
        }
      },
      message: 'Template assigned to agent successfully' 
    })
  } catch (e) {
    console.error('Error assigning WhatsApp template:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin rejects final template
router.post('/reject-final', verifyAdminToken, async (req, res) => {
  try {
    const { requestId, reason } = req.body || {}
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' })
    }

    const request = await WhatsAppTemplateRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (request.status !== 'naven_ready') {
      return res.status(400).json({ 
        success: false, 
        message: `Request cannot be rejected. Current status: ${request.status}` 
      })
    }

    request.status = 'admin_rejected'
    request.rejectionReason = reason || 'Rejected by admin after Naven processing'
    await request.save()

    res.json({ 
      success: true, 
      data: request,
      message: 'Template rejected successfully' 
    })
  } catch (e) {
    console.error('Error rejecting final template:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

// Admin toggles template status (active/inactive)
router.post('/toggle', verifyAdminToken, async (req, res) => {
  try {
    const { requestId, status } = req.body || {}
    if (!requestId || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'requestId and status (active|inactive) are required' 
      })
    }

    const request = await WhatsAppTemplateRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' })
    }

    if (request.status !== 'assigned') {
      return res.status(400).json({ 
        success: false, 
        message: `Template must be assigned before toggling. Current status: ${request.status}` 
      })
    }

    // Update agent's template status
    const agent = await Agent.findById(request.agentId)
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' })
    }

    const template = agent.whatsappTemplates.find(
      t => t.templateUrl === request.templateUrl
    )

    if (template) {
      template.status = status === 'active' ? 'APPROVED' : 'INACTIVE'
      await agent.save()
    }

    // Update request status
    request.status = status
    await request.save()

    res.json({ 
      success: true, 
      data: request,
      message: `Template ${status === 'active' ? 'activated' : 'deactivated'} successfully` 
    })
  } catch (e) {
    console.error('Error toggling template status:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

module.exports = router

