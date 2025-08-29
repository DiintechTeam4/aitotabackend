const express = require('express')
const router = express.Router()

const Agent = require('../models/Agent')
const AgentAccessRequest = require('../models/AgentAccessRequest')

// Create a new access request (by agent or client context)
// POST /api/v1/agent-access/request
// body: { clientId, agentId, platform, templateName }
router.post('/request', async (req, res) => {
  try {
    const { clientId, agentId, platform, templateName } = req.body || {}
    if (!clientId || !agentId || !platform) {
      return res.status(400).json({ success: false, message: 'clientId, agentId, platform are required' })
    }

    const supported = ['whatsapp', 'telegram', 'email', 'sms']
    if (!supported.includes(String(platform))) {
      return res.status(400).json({ success: false, message: 'Invalid platform' })
    }

    const existing = await AgentAccessRequest.findOne({ clientId, agentId, platform, status: 'pending' })
    if (existing) {
      return res.json({ success: true, message: 'Request already pending', data: existing })
    }

    const created = await AgentAccessRequest.create({ clientId, agentId, platform, templateName })
    return res.status(201).json({ success: true, data: created })
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message })
  }
})

// List requests (admin view)
// GET /api/v1/agent-access/requests?status=pending&platform=whatsapp&clientId=...&agentId=...
router.get('/requests', async (req, res) => {
  try {
    const { status, platform, clientId, agentId } = req.query || {}
    const filter = {}
    if (status) filter.status = status
    if (platform) filter.platform = platform
    if (clientId) filter.clientId = clientId
    if (agentId) filter.agentId = agentId

    const items = await AgentAccessRequest.find(filter).sort({ createdAt: -1 }).lean()
    return res.json({ success: true, data: items })
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message })
  }
})

// Approve a request and update the Agent with the platform link
// POST /api/v1/agent-access/approve
// body: { requestId, templateName? } // templateName optional, mainly for WhatsApp to build URL
router.post('/approve', async (req, res) => {
  try {
    const { requestId, templateName } = req.body || {}
    if (!requestId) return res.status(400).json({ success: false, message: 'requestId is required' })

    const reqDoc = await AgentAccessRequest.findById(requestId)
    if (!reqDoc) return res.status(404).json({ success: false, message: 'Request not found' })
    if (reqDoc.status !== 'pending') return res.status(400).json({ success: false, message: 'Request already processed' })

    const agent = await Agent.findById(reqDoc.agentId)
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' })

    // Build link for WhatsApp per requirement
    if (reqDoc.platform === 'whatsapp') {
      const base = 'https://whatsapp-template-module.onrender.com/api/whatsapp/send'
      // Prefer explicit templateName provided by admin approval; fallback to stored one (if any)
      const chosenTemplateName = (templateName && String(templateName).trim()) || (reqDoc.templateName && String(reqDoc.templateName).trim()) || ''
      const suffix = chosenTemplateName ? `-${chosenTemplateName}` : ''
      const link = base + suffix
      agent.whatsappEnabled = true
      agent.whatsapplink = link
      // Keep array form too if you want both
      agent.whatsapp = [{ link }]
      // Persist chosen template name on the request for auditability
      if (chosenTemplateName && !reqDoc.templateName) {
        reqDoc.templateName = chosenTemplateName
      }
    }

    // Other platforms could be set similarly in future

    await agent.save()
    reqDoc.status = 'approved'
    await reqDoc.save()

    return res.json({ success: true, message: 'Request approved', data: { request: reqDoc, agent } })
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message })
  }
})

module.exports = router


