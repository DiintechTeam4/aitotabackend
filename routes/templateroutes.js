const express = require('express')
const router = express.Router()

const Template = require('../models/Template')
const Agent = require('../models/Agent')
const mongoose = require('mongoose')

// Create a template
router.post('/', async (req, res) => {
  try {
    const { platform, name, url, imageUrl, description } = req.body || {}
    if (!platform || !name || !url) {
      return res.status(400).json({ success: false, message: 'platform, name and url are required' })
    }
    const tpl = await Template.create({ platform, name, url, imageUrl, description, createdBy: req.user?.id })
    res.status(201).json({ success: true, data: tpl })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

// List templates (optionally filter by platform)
router.get('/', async (req, res) => {
  try {
    const { platform } = req.query
    const filter = platform ? { platform } : {}
    const data = await Template.find(filter).sort({ createdAt: -1 })
    res.json({ success: true, data })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

// Assign templates to an agent
router.post('/assign', async (req, res) => {
  try {
    const { agentId, templateIds } = req.body || {}
    if (!agentId || !Array.isArray(templateIds)) {
      return res.status(400).json({ success: false, message: 'agentId and templateIds[] are required' })
    }

    const agent = await Agent.findById(agentId)
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' })

    const ids = templateIds
      .map(id => { try { return new mongoose.Types.ObjectId(String(id)) } catch { return null } })
      .filter(Boolean)

    // Ensure field exists
    if (!Array.isArray(agent.templates)) agent.templates = []

    // Merge unique
    const existing = new Set(agent.templates.map(v => String(v)))
    ids.forEach(id => { if (!existing.has(String(id))) agent.templates.push(id) })
    await agent.save()

    return res.json({ success: true, data: { agentId: agent._id, templates: agent.templates } })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

// Get templates assigned to an agent
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params
    const agent = await Agent.findById(agentId).populate('templates')
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' })
    res.json({ success: true, data: agent.templates || [] })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

module.exports = router


