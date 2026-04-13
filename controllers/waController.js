const WaCampaign = require('../models/WaCampaign');
const WaContact = require('../models/WaContact');
const WaContactGroup = require('../models/WaContactGroup');
const WaTemplate = require('../models/WaTemplate');
const WaMessage = require('../models/WaMessage');
const WaAnalytics = require('../models/WaAnalytics');
const WaBotFlow = require('../models/WaBotFlow');
const WaConversation = require('../models/WaConversation');
const Client = require('../models/Client');
const waService = require('../services/waService');
const csv = require('csv-parser');
const { Readable } = require('stream');

const ok = (res, data, msg = 'Success', code = 200) => res.status(code).json({ success: true, data, message: msg });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

function normalizePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  return (d.length >= 10 && d.length <= 15) ? d : null;
}

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer.toString('utf8')).pipe(csv({ skipEmptyLines: true, trim: true }))
      .on('data', (r) => rows.push(r)).on('end', () => resolve(rows)).on('error', reject);
  });
}

// ── WHATSAPP CONNECT ──────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const client = await Client.findById(req.clientId).select('+waAccessToken');
    if (!client) return fail(res, 'Client not found', 404);
    return ok(res, { waPhoneNumberId: client.waPhoneNumberId || '', connected: !!client.waPhoneNumberId, name: client.name, email: client.email, businessName: client.businessName }, 'Profile');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.connectWhatsApp = async (req, res) => {
  try {
    const { whatsappPhoneNumberId, whatsappAccessToken } = req.body;
    if (!whatsappPhoneNumberId || !whatsappAccessToken) return fail(res, 'Phone Number ID and Access Token required');
    const client = await Client.findById(req.clientId);
    if (!client) return fail(res, 'Client not found', 404);
    client.waPhoneNumberId = whatsappPhoneNumberId.trim();
    client.waAccessToken = whatsappAccessToken.trim();
    await client.save();
    return ok(res, null, 'WhatsApp connected');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── CONTACTS ─────────────────────────────────────────────────────────────────
exports.createContact = async (req, res) => {
  try {
    const { name, phone, email, tags, group, optedOut } = req.body;
    const norm = normalizePhone(phone);
    if (!name || !norm) return fail(res, 'Valid name and phone are required');
    const contact = await WaContact.create({ userId: req.clientId, name, phone: norm, email: email || '', tags: Array.isArray(tags) ? tags : [], group: Array.isArray(group) ? group : [], optedOut: Boolean(optedOut) });
    return ok(res, { contact }, 'Contact added', 201);
  } catch (e) {
    if (e.code === 11000) return fail(res, 'Contact with this phone already exists');
    return fail(res, e.message || 'Failed', 500);
  }
};

exports.importContacts = async (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, 'CSV file required');
    let rows;
    try { rows = await parseCsvBuffer(req.file.buffer); } catch { return fail(res, 'Invalid CSV file'); }
    const created = [], skipped = [];
    for (const row of rows) {
      const phoneRaw = row.phone || row.Phone || row.mobile || row.Mobile || row.number;
      const nameRaw = row.name || row.Name || 'Unknown';
      const norm = normalizePhone(phoneRaw);
      if (!norm) { skipped.push({ row, reason: 'Invalid phone' }); continue; }
      try {
        const c = await WaContact.create({ userId: req.clientId, name: String(nameRaw).trim() || 'Unknown', phone: norm, email: String(row.email || '').trim(), tags: [], group: [], optedOut: false });
        created.push(c);
      } catch (err) { skipped.push({ phone: norm, reason: err.code === 11000 ? 'Duplicate' : err.message }); }
    }
    return ok(res, { imported: created.length, skipped: skipped.length }, `Imported ${created.length} contacts`);
  } catch (e) { return fail(res, e.message || 'Import failed', 500); }
};

exports.listContacts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = (req.query.search || '').trim();
    const filter = { userId: req.clientId };
    if (search) filter.$or = [{ name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { phone: new RegExp(search.replace(/\D/g, ''), 'i') }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const [contacts, total] = await Promise.all([WaContact.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), WaContact.countDocuments(filter)]);
    return ok(res, { contacts, pagination: { page, limit, total } }, 'Contacts');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.updateContact = async (req, res) => {
  try {
    const { name, email, tags, group, optedOut, phone } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (tags !== undefined) update.tags = tags;
    if (group !== undefined) update.group = group;
    if (optedOut !== undefined) update.optedOut = optedOut;
    if (phone !== undefined) { const norm = normalizePhone(phone); if (!norm) return fail(res, 'Invalid phone'); update.phone = norm; }
    const contact = await WaContact.findOneAndUpdate({ _id: req.params.id, userId: req.clientId }, update, { new: true });
    if (!contact) return fail(res, 'Contact not found', 404);
    return ok(res, { contact }, 'Contact updated');
  } catch (e) {
    if (e.code === 11000) return fail(res, 'Duplicate phone');
    return fail(res, e.message || 'Update failed', 500);
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const c = await WaContact.findOneAndDelete({ _id: req.params.id, userId: req.clientId });
    if (!c) return fail(res, 'Contact not found', 404);
    return ok(res, null, 'Contact deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return fail(res, 'Group name required');
    const group = await WaContactGroup.create({ userId: req.clientId, name, description: description || '' });
    return ok(res, { group }, 'Group created', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listGroups = async (req, res) => {
  try {
    const groups = await WaContactGroup.find({ userId: req.clientId }).sort({ name: 1 });
    return ok(res, { groups }, 'Groups');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.deleteGroup = async (req, res) => {
  try {
    const group = await WaContactGroup.findOneAndDelete({ _id: req.params.id, userId: req.clientId });
    if (!group) return fail(res, 'Group not found', 404);
    return ok(res, null, 'Group deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
exports.createTemplate = async (req, res) => {
  try {
    const { name, whatsappTemplateName, languageCode, bodyPreview, sampleParams } = req.body;
    if (!name || !whatsappTemplateName) return fail(res, 'Name and WhatsApp template name are required');
    const template = await WaTemplate.create({ userId: req.clientId, name, whatsappTemplateName, languageCode: languageCode || 'en', bodyPreview: bodyPreview || '', sampleParams: Array.isArray(sampleParams) ? sampleParams : [] });
    return ok(res, { template }, 'Template saved', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listTemplates = async (req, res) => {
  try {
    const templates = await WaTemplate.find({ userId: req.clientId }).sort({ createdAt: -1 });
    return ok(res, { templates }, 'Templates');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.getTemplate = async (req, res) => {
  try {
    const template = await WaTemplate.findOne({ _id: req.params.id, userId: req.clientId });
    if (!template) return fail(res, 'Template not found', 404);
    return ok(res, { template }, 'Template');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.updateTemplate = async (req, res) => {
  try {
    const allowed = ['name', 'whatsappTemplateName', 'languageCode', 'bodyPreview', 'sampleParams'];
    const update = {};
    for (const k of allowed) { if (req.body[k] !== undefined) update[k] = req.body[k]; }
    const template = await WaTemplate.findOneAndUpdate({ _id: req.params.id, userId: req.clientId }, update, { new: true });
    if (!template) return fail(res, 'Template not found', 404);
    return ok(res, { template }, 'Template updated');
  } catch (e) { return fail(res, e.message || 'Update failed', 500); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const t = await WaTemplate.findOneAndDelete({ _id: req.params.id, userId: req.clientId });
    if (!t) return fail(res, 'Template not found', 404);
    return ok(res, null, 'Template deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
async function runCampaignSendJob(campaignId, clientId) {
  const campaign = await WaCampaign.findOne({ _id: campaignId, userId: clientId });
  if (!campaign || campaign.status !== 'running') return;
  const template = await WaTemplate.findOne({ _id: campaign.template, userId: clientId });
  if (!template) { campaign.status = 'failed'; await campaign.save(); return; }
  const contacts = await WaContact.find({ userId: clientId, group: { $in: [campaign.targetGroup] }, optedOut: false });
  campaign.totalContacts = contacts.length;
  await campaign.save();
  const params = (template.sampleParams || []).map((s) => ({ type: 'text', text: String(s.value ?? ''), parameter_name: s.key }));
  let sent = 0, failed = 0;
  for (let i = 0; i < contacts.length; i++) {
    const phone = contacts[i].phone.replace(/\D/g, '');
    const msgDoc = await WaMessage.create({ userId: clientId, campaignId: campaign._id, direction: 'outbound', from: 'business', to: phone, body: `${template.whatsappTemplateName} (${template.name})`, type: 'template', status: 'pending' });
    try {
      const apiRes = await waService.sendTemplateMessage(clientId, phone, template.whatsappTemplateName, template.languageCode || 'en', params);
      msgDoc.status = 'sent'; msgDoc.whatsappMessageId = apiRes?.messages?.[0]?.id || ''; await msgDoc.save(); sent++;
    } catch (err) { msgDoc.status = 'failed'; msgDoc.errorReason = err.response?.data?.error?.message || err.message; await msgDoc.save(); failed++; }
    campaign.sent = sent; campaign.failed = failed; await campaign.save();
  }
  campaign.status = 'completed'; await campaign.save();
}

exports.createCampaign = async (req, res) => {
  try {
    const { name, targetGroup, template, scheduledAt } = req.body;
    if (!name || !targetGroup || !template) return fail(res, 'Name, target group and template are required');
    let status = 'draft', scheduleDate = null;
    if (scheduledAt) { scheduleDate = new Date(scheduledAt); if (scheduleDate > new Date()) status = 'scheduled'; }
    const campaign = await WaCampaign.create({ userId: req.clientId, name, targetGroup, template, status, scheduledAt: status === 'scheduled' ? scheduleDate : null });
    return ok(res, { campaign }, 'Campaign created', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listCampaigns = async (req, res) => {
  try {
    const campaigns = await WaCampaign.find({ userId: req.clientId }).sort({ createdAt: -1 });
    return ok(res, { campaigns }, 'Campaigns');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.getCampaign = async (req, res) => {
  try {
    const campaign = await WaCampaign.findOne({ _id: req.params.id, userId: req.clientId });
    if (!campaign) return fail(res, 'Campaign not found', 404);
    const messages = await WaMessage.find({ campaignId: campaign._id }).sort({ createdAt: -1 }).limit(500);
    return ok(res, { campaign, messages }, 'Campaign detail');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const c = await WaCampaign.findOneAndDelete({ _id: req.params.id, userId: req.clientId });
    if (!c) return fail(res, 'Campaign not found', 404);
    await WaMessage.deleteMany({ campaignId: c._id });
    return ok(res, null, 'Campaign deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.sendCampaign = async (req, res) => {
  try {
    const campaign = await WaCampaign.findOne({ _id: req.params.id, userId: req.clientId });
    if (!campaign) return fail(res, 'Campaign not found', 404);
    if (campaign.status === 'running') return fail(res, 'Campaign is already running');
    campaign.status = 'running'; campaign.scheduledAt = null; await campaign.save();
    setImmediate(() => runCampaignSendJob(campaign._id, req.clientId).catch(console.error));
    return ok(res, { campaign }, 'Campaign send started');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
exports.analyticsOverview = async (req, res) => {
  try {
    const [agg] = await WaMessage.aggregate([
      { $match: { userId: req.clientId, direction: 'outbound' } },
      { $group: { _id: null, total: { $sum: 1 }, sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
    ]);
    const t = agg || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    const outbound = t.total || 0;
    return ok(res, { totalMessages: outbound, deliveredPercent: outbound ? Math.min(100, Math.round(((t.delivered + t.read + t.sent) / outbound) * 100)) : 0, readPercent: outbound ? Math.min(100, Math.round((t.read / outbound) * 100)) : 0, failedPercent: outbound ? Math.round((t.failed / outbound) * 100) : 0 }, 'Overview');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.analyticsCampaigns = async (req, res) => {
  try {
    const campaigns = await WaCampaign.find({ userId: req.clientId }).sort({ createdAt: -1 }).limit(50).select('name status totalContacts sent delivered read failed createdAt');
    return ok(res, { campaigns }, 'Campaign stats');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.analyticsTimeline = async (req, res) => {
  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const rows = await WaMessage.aggregate([
      { $match: { userId: req.clientId, direction: 'outbound', createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return ok(res, { timeline: rows.map((r) => ({ date: r._id, messages: r.count })) }, 'Timeline');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── INBOX ─────────────────────────────────────────────────────────────────────
exports.listConversations = async (req, res) => {
  try {
    const conversations = await WaConversation.find({ userId: req.clientId }).sort({ lastMessageAt: -1 });
    return ok(res, { conversations }, 'Conversations');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.getMessages = async (req, res) => {
  try {
    const conv = await WaConversation.findOne({ _id: req.params.id, userId: req.clientId });
    if (!conv) return fail(res, 'Conversation not found', 404);
    const messages = await WaMessage.find({ conversationId: conv._id }).sort({ createdAt: 1 });
    conv.unreadCount = 0; await conv.save();
    return ok(res, { messages, conversation: conv }, 'Messages');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.replyConversation = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return fail(res, 'Message text required');
    const conv = await WaConversation.findOne({ _id: req.params.id, userId: req.clientId });
    if (!conv) return fail(res, 'Conversation not found', 404);
    const phone = conv.customerPhone.replace(/\D/g, '');
    const msgDoc = await WaMessage.create({ userId: req.clientId, conversationId: conv._id, direction: 'outbound', from: 'agent', to: phone, body: text, type: 'text', status: 'pending' });
    try {
      const apiRes = await waService.sendTextMessage(req.clientId, phone, text);
      msgDoc.status = 'sent'; msgDoc.whatsappMessageId = apiRes?.messages?.[0]?.id || ''; await msgDoc.save();
    } catch (err) { msgDoc.status = 'failed'; msgDoc.errorReason = err.response?.data?.error?.message || err.message; await msgDoc.save(); return fail(res, msgDoc.errorReason || 'Failed to send', 502); }
    conv.lastMessage = text; conv.lastMessageAt = new Date(); conv.botContext = { flowId: null, currentNodeId: '', awaitingMenu: false }; await conv.save();
    return ok(res, { message: msgDoc }, 'Reply sent');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.assignConversation = async (req, res) => {
  try {
    const { assignedAgent } = req.body;
    const conv = await WaConversation.findOneAndUpdate({ _id: req.params.id, userId: req.clientId }, { assignedAgent: assignedAgent || '' }, { new: true });
    if (!conv) return fail(res, 'Conversation not found', 404);
    return ok(res, { conversation: conv }, 'Assignment updated');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── BOT FLOW ──────────────────────────────────────────────────────────────────
exports.getFlow = async (req, res) => {
  try {
    let flow = await WaBotFlow.findOne({ userId: req.clientId });
    if (!flow) flow = await WaBotFlow.create({ userId: req.clientId, triggerKeyword: 'hi', nodes: [{ id: 'welcome', type: 'message', content: 'Hello! How can we help?', options: [], nextNodeId: '' }] });
    return ok(res, { flow }, 'Bot flow');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.saveFlow = async (req, res) => {
  try {
    const { triggerKeyword, nodes } = req.body;
    const flow = await WaBotFlow.findOneAndUpdate({ userId: req.clientId }, { userId: req.clientId, triggerKeyword: (triggerKeyword || 'hi').toLowerCase().trim(), nodes: Array.isArray(nodes) ? nodes : [] }, { upsert: true, new: true });
    return ok(res, { flow }, 'Bot flow saved');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── WEBHOOK ───────────────────────────────────────────────────────────────────
exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'myverifytoken123')) return res.status(200).send(challenge);
  return res.sendStatus(403);
};

exports.receiveWebhook = async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        const client = await Client.findOne({ waPhoneNumberId: phoneNumberId }).select('+waAccessToken');
        if (!client) continue;
        if (value.messages) await handleInbound(client, value);
        if (value.statuses) await handleStatus(client, value);
      }
    }
    return res.sendStatus(200);
  } catch (e) { console.error('Webhook error:', e); return res.sendStatus(500); }
};

async function handleInbound(client, value) {
  for (const m of (value.messages || [])) {
    const from = m.from;
    const name = value.contacts?.[0]?.profile?.name || '';
    let textBody = m.type === 'text' ? (m.text?.body || '') : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.button_reply?.id || '') : `[${m.type}]`;

    // Upsert conversation
    let conv = await WaConversation.findOne({ userId: client._id, customerPhone: from });
    if (!conv) conv = await WaConversation.create({ userId: client._id, customerPhone: from, customerName: name, lastMessage: textBody, lastMessageAt: new Date(), unreadCount: 1 });
    else { conv.customerName = name || conv.customerName; conv.lastMessage = textBody; conv.lastMessageAt = new Date(); conv.unreadCount = (conv.unreadCount || 0) + 1; await conv.save(); }

    // Save inbound message
    await WaMessage.create({ userId: client._id, conversationId: conv._id, direction: 'inbound', from, to: client.waPhoneNumberId, body: textBody, type: m.type || 'text', status: 'delivered', whatsappMessageId: m.id || '' });
    if (m.id) { try { await waService.markMessageRead(client._id, m.id); } catch {} }

    // Bot flow auto-reply
    try { await processBotFlow(client, conv, textBody, from); } catch (e) { console.error('Bot flow error:', e.message); }
  }
}

async function processBotFlow(client, conv, userText, from) {
  const flow = await WaBotFlow.findOne({ userId: client._id });
  if (!flow || !flow.nodes || !flow.nodes.length) return;

  const input = userText.trim().toLowerCase();
  let targetNodeId = '';

  // Check if awaiting menu selection
  if (conv.botContext?.awaitingMenu && conv.botContext?.currentNodeId) {
    const menuNode = flow.nodes.find(n => n.id === conv.botContext.currentNodeId);
    if (menuNode && menuNode.type === 'menu') {
      const opt = menuNode.options?.find(o => o.value === input || o.label.toLowerCase() === input);
      targetNodeId = opt ? opt.nextNodeId : menuNode.nextNodeId || '';
    }
  } else {
    // Check trigger keyword
    if (input === flow.triggerKeyword.toLowerCase()) {
      targetNodeId = flow.nodes[0]?.id || '';
    } else {
      // Try matching any menu option from current node
      const curNode = flow.nodes.find(n => n.id === conv.botContext?.currentNodeId);
      if (curNode?.type === 'menu') {
        const opt = curNode.options?.find(o => o.value === input || o.label.toLowerCase() === input);
        targetNodeId = opt ? opt.nextNodeId : '';
      }
    }
  }

  if (!targetNodeId) return;

  const node = flow.nodes.find(n => n.id === targetNodeId);
  if (!node) return;

  // Send reply
  await waService.sendTextMessage(client._id, from, node.content);

  // Save outbound message
  await WaMessage.create({ userId: client._id, conversationId: conv._id, direction: 'outbound', from: 'bot', to: from, body: node.content, type: 'text', status: 'sent' });

  // Update conversation bot context
  conv.botContext = {
    flowId: flow._id,
    currentNodeId: node.id,
    awaitingMenu: node.type === 'menu'
  };
  conv.lastMessage = node.content;
  conv.lastMessageAt = new Date();
  await conv.save();

  // If node has nextNodeId and is not menu, auto-send next node too
  if (node.nextNodeId && node.type !== 'menu') {
    const nextNode = flow.nodes.find(n => n.id === node.nextNodeId);
    if (nextNode) {
      await waService.sendTextMessage(client._id, from, nextNode.content);
      await WaMessage.create({ userId: client._id, conversationId: conv._id, direction: 'outbound', from: 'bot', to: from, body: nextNode.content, type: 'text', status: 'sent' });
      conv.botContext = { flowId: flow._id, currentNodeId: nextNode.id, awaitingMenu: nextNode.type === 'menu' };
      conv.lastMessage = nextNode.content;
      await conv.save();
    }
  }
}

async function handleStatus(client, value) {
  for (const s of (value.statuses || [])) {
    if (!s.id) continue;
    const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    const st = map[s.status];
    if (st) await WaMessage.findOneAndUpdate({ userId: client._id, whatsappMessageId: s.id }, { status: st });
  }
}
