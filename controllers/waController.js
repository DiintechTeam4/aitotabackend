const mongoose = require('mongoose');
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

/** Keep locale as in Meta (e.g. `en` vs `en_US`); do not rewrite `en` → `en_US` or sends get #132001. */
function normalizeTemplateLanguageCode(languageCode) {
  const raw = String(languageCode || '').trim();
  if (!raw) return 'en';
  return raw.replace(/-/g, '_');
}

/** Match Meta naming: trim + spaces→underscore; keep case (copy from WhatsApp Manager). */
function normalizeTemplateMetaName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '_');
}

function sanitizeSampleParams(raw, parameterFormat) {
  if (!Array.isArray(raw)) return [];
  const fmt = String(parameterFormat || 'NAMED').toUpperCase() === 'POSITIONAL' ? 'POSITIONAL' : 'NAMED';
  const rows = raw
    .map((p) => ({
      key: String(p?.key ?? '').trim(),
      value: String(p?.value ?? '').trim(),
    }))
    .filter((p) => p.key.length > 0 || p.value.length > 0);
  if (fmt === 'NAMED') {
    return rows.filter((p) => p.key.length > 0 && p.value.length > 0);
  }
  return rows.filter((p) => p.value.length > 0);
}

async function getMetaWabaIdForClient(clientId) {
  // Use env-level WABA ID if set
  if (process.env.WHATSAPP_WABA_ID) return process.env.WHATSAPP_WABA_ID;
  const axios = require('axios');
  const client = await Client.findById(clientId).select('+waAccessToken');
  if (!client?.waPhoneNumberId || !client?.waAccessToken) return null;
  const ver = process.env.WHATSAPP_API_VERSION || 'v19.0';
  const { data } = await axios.get(`https://graph.facebook.com/${ver}/${client.waPhoneNumberId}`, {
    headers: { Authorization: `Bearer ${client.waAccessToken}` },
    params: { fields: 'whatsapp_business_account' },
    timeout: 15000,
  });
  const waba = data?.whatsapp_business_account;
  return waba?.id || waba || null;
}

async function fetchApprovedMetaTemplates(clientId) {
  try {
    const axios = require('axios');
    const wabaId = await getMetaWabaIdForClient(clientId);
    if (!wabaId) return { templates: [], notConnected: true };
    const ver = process.env.WHATSAPP_API_VERSION || 'v19.0';
    const client = await Client.findById(clientId).select('+waAccessToken');
    const { data } = await axios.get(`https://graph.facebook.com/${ver}/${wabaId}/message_templates`, {
      headers: { Authorization: `Bearer ${client.waAccessToken}` },
      params: { limit: 200, fields: 'name,language,status,category' },
      timeout: 25000,
    });
    const list = data?.data || [];
    return { templates: list.filter((t) => t.status === 'APPROVED'), notConnected: false };
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message || 'Meta API error';
    return { templates: [], notConnected: false, fetchError: msg };
  }
}

function metaLanguageMatches(templateLang, wantedLang) {
  const a = String(templateLang || '').replace(/-/g, '_');
  const b = String(wantedLang || '').replace(/-/g, '_');
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if ((b === 'en_US' && a === 'en') || (b === 'en' && a === 'en_US')) return true;
  return false;
}

async function assertTemplateApprovedOnMeta(clientId, whatsappTemplateName, languageCode) {
  const { templates, notConnected, fetchError } = await fetchApprovedMetaTemplates(clientId);
  if (notConnected) return { ok: true, skipped: true };
  if (fetchError) {
    console.warn('[WA_TEMPLATE_VERIFY_SKIP] Could not load Meta templates:', fetchError);
    return { ok: true, skipped: true };
  }
  const nameWanted = String(whatsappTemplateName || '').trim();
  const langWanted = normalizeTemplateLanguageCode(languageCode);
  const nameMatches = (metaName) =>
    metaName === nameWanted || String(metaName || '').toLowerCase() === nameWanted.toLowerCase();
  const hit = templates.find((t) => nameMatches(t.name) && metaLanguageMatches(t.language, langWanted));
  if (hit) return { ok: true };
  const examples = templates.slice(0, 25).map((t) => `${t.name} (${t.language})`).join(', ');
  return {
    ok: false,
    message: `Template "${nameWanted}" is not APPROVED for language "${langWanted}" on this WhatsApp number. Use exact name + language from WhatsApp Manager.`,
    hint: examples ? `Approved examples: ${examples}` : 'No APPROVED templates returned for this account.',
  };
}

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer.toString('utf8')).pipe(csv({ skipEmptyLines: true, trim: true }))
      .on('data', (r) => rows.push(r)).on('end', () => resolve(rows)).on('error', reject);
  });
}

async function normalizeGroupIdsForUser(userId, rawGroups) {
  if (rawGroups === undefined) return undefined;
  const mongoose = require('mongoose');
  const arr = Array.isArray(rawGroups)
    ? rawGroups
    : rawGroups
    ? [rawGroups]
    : [];
  const ids = arr
    .map((g) => (typeof g === 'object' ? g?._id || g?.id : g))
    .filter(Boolean)
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const groups = await WaContactGroup.find({ userId, _id: { $in: ids } }).select('_id');
  const validIds = groups.map((g) => g._id);
  if (!validIds.length) throw new Error('Selected groups are invalid for this account');
  return validIds;
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
    const phoneId = String(whatsappPhoneNumberId).trim();
    const accessToken = String(whatsappAccessToken).trim();
    if (!/^\d{8,20}$/.test(phoneId)) {
      return fail(res, 'Invalid Phone Number ID. Numeric value required (example: 790783224112773)');
    }
    if (accessToken.length < 20) {
      return fail(res, 'Invalid Access Token');
    }

    // Validate connection with Meta Graph before saving.
    try {
      const axios = require('axios');
      await axios.get(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v19.0'}/${phoneId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'id,display_phone_number,verified_name' },
        timeout: 15000,
      });
    } catch (verifyErr) {
      // Log warning but still save — token may be valid for sending even if profile fetch fails
      console.warn('[WA_CONNECT] Meta validation warning:', verifyErr.response?.data?.error?.message || verifyErr.message);
    }

    const client = await Client.findById(req.clientId);
    if (!client) return fail(res, 'Client not found', 404);
    client.waPhoneNumberId = phoneId;
    client.waAccessToken = accessToken;
    await client.save();
    return ok(res, null, 'WhatsApp connected');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── CONTACTS ─────────────────────────────────────────────────────────────────
exports.createContact = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { name, phone, email, tags, group, groups, optedOut } = req.body;
    const norm = normalizePhone(phone);
    if (!name || !norm) return fail(res, 'Valid name and phone are required');
    const clientObjId = new mongoose.Types.ObjectId(String(req.clientId));
    const groupIds = await normalizeGroupIdsForUser(clientObjId, group !== undefined ? group : groups);
    const contact = await WaContact.create({
      userId: clientObjId,
      name,
      phone: norm,
      email: email || '',
      tags: Array.isArray(tags) ? tags : [],
      group: Array.isArray(groupIds) ? groupIds : [],
      optedOut: Boolean(optedOut),
    });
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
    const mongoose = require('mongoose');
    const clientObjId = new mongoose.Types.ObjectId(String(req.clientId));
    const filter = { userId: clientObjId };
    if (search) filter.$or = [
      { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { phone: new RegExp(search.replace(/\D/g, ''), 'i') },
      { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ];
    const [contacts, total] = await Promise.all([
      WaContact.find(filter).populate('group', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      WaContact.countDocuments(filter)
    ]);
    return ok(res, { contacts, pagination: { page, limit, total } }, 'Contacts');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.updateContact = async (req, res) => {
  try {
    const { name, email, tags, group, groups, optedOut, phone } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (tags !== undefined) update.tags = tags;
    if (group !== undefined || groups !== undefined) {
      const normalized = await normalizeGroupIdsForUser(
        req.clientId,
        group !== undefined ? group : groups
      );
      update.group = normalized;
    }
    if (optedOut !== undefined) update.optedOut = optedOut;
    if (phone !== undefined) { const norm = normalizePhone(phone); if (!norm) return fail(res, 'Invalid phone'); update.phone = norm; }
    // Use string comparison to avoid ObjectId type mismatch
    const contact = await WaContact.findOneAndUpdate(
      { _id: req.params.id, userId: req.clientId },
      { $set: update },
      { new: true }
    ).populate('group', 'name');
    if (!contact) {
      // Fallback: try without userId filter (in case of type mismatch)
      const fallback = await WaContact.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
      ).populate('group', 'name');
      if (!fallback) return fail(res, 'Contact not found', 404);
      return ok(res, { contact: fallback }, 'Contact updated');
    }
    return ok(res, { contact }, 'Contact updated');
  } catch (e) {
    if (e.code === 11000) return fail(res, 'Duplicate phone');
    return fail(res, e.message || 'Update failed', 500);
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const c = await WaContact.findByIdAndDelete(req.params.id);
    if (!c) return fail(res, 'Contact not found', 404);
    return ok(res, null, 'Contact deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.createGroup = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { name, description } = req.body;
    if (!name) return fail(res, 'Group name required');
    const clientObjId = new mongoose.Types.ObjectId(String(req.clientId));
    const group = await WaContactGroup.create({ userId: clientObjId, name, description: description || '' });
    return ok(res, { group }, 'Group created', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listGroups = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const clientObjId = new mongoose.Types.ObjectId(String(req.clientId));
    const groups = await WaContactGroup.find({ userId: clientObjId }).sort({ name: 1 });
    return ok(res, { groups }, 'Groups');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.deleteGroup = async (req, res) => {
  try {
    const group = await WaContactGroup.findByIdAndDelete(req.params.id);
    if (!group) return fail(res, 'Group not found', 404);
    return ok(res, null, 'Group deleted');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
exports.createTemplate = async (req, res) => {
  try {
    const { name, whatsappTemplateName, languageCode, bodyPreview, sampleParams, parameterFormat } = req.body;
    if (!name || !whatsappTemplateName) return fail(res, 'Name and WhatsApp template name are required');
    const fmt = String(parameterFormat || 'NAMED').toUpperCase() === 'POSITIONAL' ? 'POSITIONAL' : 'NAMED';
    const cleanedParams = sanitizeSampleParams(sampleParams, fmt);
    const waName = normalizeTemplateMetaName(whatsappTemplateName);
    const lang = normalizeTemplateLanguageCode(languageCode);

    const check = await assertTemplateApprovedOnMeta(req.clientId, waName, lang);
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.message, data: { hint: check.hint } });
    }

    const template = await WaTemplate.create({
      userId: req.clientId,
      name: String(name).trim(),
      whatsappTemplateName: waName,
      languageCode: lang,
      bodyPreview: bodyPreview || '',
      parameterFormat: fmt,
      sampleParams: cleanedParams,
    });
    return ok(res, { template }, 'Template saved', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listMetaApprovedTemplates = async (req, res) => {
  try {
    const { templates, notConnected, fetchError } = await fetchApprovedMetaTemplates(req.clientId);
    if (notConnected) return fail(res, 'Connect WhatsApp in Settings to load Meta-approved templates.', 400);
    if (fetchError) return fail(res, fetchError, 502);
    return ok(res, { templates }, 'Approved Meta templates');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

/** Save one template to Mongo using exact Meta `name` + `language` (recommended path for campaigns). */
exports.cloneTemplateFromMeta = async (req, res) => {
  try {
    const { displayName, metaName, language } = req.body || {};
    if (metaName === undefined || metaName === '' || language === undefined || language === '') {
      return fail(res, 'metaName and language are required — copy from Meta sync list (exact).', 400);
    }
    const { templates, notConnected, fetchError } = await fetchApprovedMetaTemplates(req.clientId);
    if (notConnected) return fail(res, 'Connect WhatsApp in Settings first.', 400);
    if (fetchError) return fail(res, fetchError, 502);
    const nameTrim = String(metaName).trim();
    const langRaw = String(language).trim();
    const hit = templates.find((t) => t.name === nameTrim && String(t.language) === langRaw);
    if (!hit) {
      return res.status(400).json({
        success: false,
        message: `No APPROVED template "${nameTrim}" with language "${langRaw}". Open sync list and use exact values.`,
      });
    }
    const langStore = String(hit.language).replace(/-/g, '_');
    const dup = await WaTemplate.findOne({
      userId: req.clientId,
      whatsappTemplateName: hit.name,
      languageCode: langStore,
    });
    if (dup) {
      return ok(res, { template: dup, existed: true }, 'Already saved in database');
    }
    const template = await WaTemplate.create({
      userId: req.clientId,
      name: String(displayName || hit.name).trim(),
      whatsappTemplateName: hit.name,
      languageCode: langStore,
      bodyPreview: '',
      parameterFormat: 'NAMED',
      sampleParams: [],
    });
    return ok(res, { template, existed: false }, 'Template saved from Meta', 201);
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
    const allowed = ['name', 'whatsappTemplateName', 'languageCode', 'bodyPreview', 'sampleParams', 'parameterFormat'];
    const update = {};
    for (const k of allowed) { if (req.body[k] !== undefined) update[k] = req.body[k]; }
    const existing = await WaTemplate.findOne({ _id: req.params.id, userId: req.clientId });
    if (!existing) return fail(res, 'Template not found', 404);

    if (update.name !== undefined) update.name = String(update.name).trim();
    if (update.whatsappTemplateName !== undefined) {
      update.whatsappTemplateName = normalizeTemplateMetaName(update.whatsappTemplateName);
    }
    if (update.languageCode !== undefined) {
      update.languageCode = normalizeTemplateLanguageCode(update.languageCode);
    }
    if (update.parameterFormat !== undefined) {
      update.parameterFormat = String(update.parameterFormat).toUpperCase() === 'POSITIONAL' ? 'POSITIONAL' : 'NAMED';
    }

    const nextFmt = update.parameterFormat !== undefined ? update.parameterFormat : existing.parameterFormat;
    if (update.sampleParams !== undefined) {
      update.sampleParams = sanitizeSampleParams(update.sampleParams, nextFmt);
    } else if (update.parameterFormat !== undefined) {
      update.sampleParams = sanitizeSampleParams(existing.sampleParams, nextFmt);
    }

    const waName = update.whatsappTemplateName !== undefined ? update.whatsappTemplateName : existing.whatsappTemplateName;
    const lang = update.languageCode !== undefined ? update.languageCode : existing.languageCode;
    if (update.whatsappTemplateName !== undefined || update.languageCode !== undefined) {
      const check = await assertTemplateApprovedOnMeta(req.clientId, waName, lang);
      if (!check.ok) {
        return res.status(400).json({ success: false, message: check.message, data: { hint: check.hint } });
      }
    }

    const template = await WaTemplate.findOneAndUpdate({ _id: req.params.id, userId: req.clientId }, { $set: update }, { new: true });
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
  if (!template) {
    campaign.status = 'failed';
    campaign.lastError = 'Template not found for this campaign';
    await campaign.save();
    console.error('[WA_CAMPAIGN_FAIL]', {
      campaignId: String(campaign._id),
      userId: String(clientId),
      reason: campaign.lastError,
    });
    return;
  }
  const contacts = await WaContact.find({ userId: clientId, group: campaign.targetGroup, optedOut: false });
  campaign.totalContacts = contacts.length;
  campaign.lastError = '';
  await campaign.save();
  const paramFmt = String(template.parameterFormat || 'NAMED').toUpperCase() === 'POSITIONAL' ? 'POSITIONAL' : 'NAMED';
  let params;
  if (paramFmt === 'POSITIONAL') {
    params = (template.sampleParams || []).map((s) => String(s.value ?? ''));
  } else {
    params = (template.sampleParams || []).map((s) => ({ type: 'text', text: String(s.value ?? ''), parameter_name: s.key }));
  }
  let sent = 0, failed = 0;
  for (let i = 0; i < contacts.length; i++) {
    const phone = contacts[i].phone.replace(/\D/g, '');
    const msgDoc = await WaMessage.create({ userId: clientId, campaignId: campaign._id, direction: 'outbound', from: 'business', to: phone, body: `${template.whatsappTemplateName} (${template.name})`, type: 'template', status: 'pending' });
    try {
      const apiRes = await waService.sendTemplateMessage(
        clientId,
        phone,
        template.whatsappTemplateName,
        template.languageCode || 'en',
        params,
        paramFmt
      );
      msgDoc.status = 'sent'; msgDoc.whatsappMessageId = apiRes?.messages?.[0]?.id || ''; await msgDoc.save(); sent++;
    } catch (err) {
      const errorReason = err.response?.data?.error?.message || err.message || 'Unknown WhatsApp API error';
      msgDoc.status = 'failed';
      msgDoc.errorReason = errorReason;
      await msgDoc.save();
      failed++;
      campaign.lastError = errorReason;
      console.error('[WA_CAMPAIGN_SEND_ERROR]', {
        campaignId: String(campaign._id),
        userId: String(clientId),
        contactId: String(contacts[i]._id),
        phone,
        templateName: template.whatsappTemplateName,
        reason: errorReason,
        meta: err.response?.data?.error || null,
      });
    }
    campaign.sent = sent; campaign.failed = failed; await campaign.save();
  }
  if (failed > 0 && !campaign.lastError) {
    campaign.lastError = 'Message send failed, but detailed WhatsApp error was not returned.';
  }
  campaign.status = sent === 0 && failed > 0 ? 'failed' : 'completed';
  await campaign.save();
}

exports.createCampaign = async (req, res) => {
  try {
    const { name, targetGroup, template, scheduledAt } = req.body;
    if (!name || !targetGroup || !template) return fail(res, 'Name, target group and template are required');
    const [groupExists, templateDoc] = await Promise.all([
      WaContactGroup.exists({ _id: targetGroup, userId: req.clientId }),
      WaTemplate.findOne({ _id: template, userId: req.clientId }).select('whatsappTemplateName languageCode'),
    ]);
    if (!groupExists) return fail(res, 'Selected group not found', 404);
    if (!templateDoc) return fail(res, 'Selected template not found', 404);
    if (!String(templateDoc.whatsappTemplateName || '').trim()) {
      return fail(res, 'Selected template is invalid. Please set a valid Meta template name.', 400);
    }
    const metaCheck = await assertTemplateApprovedOnMeta(
      req.clientId,
      templateDoc.whatsappTemplateName,
      templateDoc.languageCode
    );
    if (!metaCheck.ok) {
      return res.status(400).json({ success: false, message: metaCheck.message, data: { hint: metaCheck.hint } });
    }
    let status = 'draft', scheduleDate = null;
    if (scheduledAt) { scheduleDate = new Date(scheduledAt); if (scheduleDate > new Date()) status = 'scheduled'; }
    const campaign = await WaCampaign.create({ userId: req.clientId, name, targetGroup, template, status, scheduledAt: status === 'scheduled' ? scheduleDate : null });
    return ok(res, { campaign }, 'Campaign created', 201);
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.listCampaigns = async (req, res) => {
  try {
    const campaigns = await WaCampaign.find({ userId: req.clientId }).sort({ createdAt: -1 }).lean();
    const missingErrorCampaignIds = campaigns
      .filter((c) => Number(c.failed || 0) > 0 && !c.lastError)
      .map((c) => c._id);

    if (missingErrorCampaignIds.length) {
      const latestFailedMessages = await WaMessage.aggregate([
        { $match: { campaignId: { $in: missingErrorCampaignIds }, status: 'failed' } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$campaignId',
            lastReason: { $first: '$errorReason' },
          },
        },
      ]);
      const reasonMap = new Map(latestFailedMessages.map((m) => [String(m._id), m.lastReason]));
      for (const campaign of campaigns) {
        if (Number(campaign.failed || 0) > 0 && !campaign.lastError) {
          campaign.lastError =
            reasonMap.get(String(campaign._id)) ||
            'Campaign failed but exact reason was not captured. Please deploy latest backend.';
        }
      }
    }
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
    const [groupExists, templateDoc, totalEligibleContacts, totalContactsInGroup, optedOutInGroup] = await Promise.all([
      WaContactGroup.exists({ _id: campaign.targetGroup, userId: req.clientId }),
      WaTemplate.findOne({ _id: campaign.template, userId: req.clientId }).select('whatsappTemplateName languageCode'),
      WaContact.countDocuments({ userId: req.clientId, group: campaign.targetGroup, optedOut: false }),
      WaContact.countDocuments({ userId: req.clientId, group: campaign.targetGroup }),
      WaContact.countDocuments({ userId: req.clientId, group: campaign.targetGroup, optedOut: true }),
    ]);
    if (!groupExists) return fail(res, 'Campaign group not found', 404);
    if (!templateDoc) return fail(res, 'Campaign template not found', 404);
    if (!String(templateDoc.whatsappTemplateName || '').trim()) {
      return fail(res, 'Campaign template is invalid. Please update template name in Templates page.', 400);
    }
    const metaCheck = await assertTemplateApprovedOnMeta(
      req.clientId,
      templateDoc.whatsappTemplateName,
      templateDoc.languageCode
    );
    if (!metaCheck.ok) {
      return res.status(400).json({ success: false, message: metaCheck.message, data: { hint: metaCheck.hint } });
    }
    if (!totalEligibleContacts) {
      return res.status(400).json({
        success: false,
        message:
          totalContactsInGroup > 0
            ? 'All contacts in this group are opted-out. Enable at least one contact.'
            : 'No contacts assigned to selected group',
        data: {
          campaignId: String(campaign._id),
          groupId: String(campaign.targetGroup),
          eligibleContacts: totalEligibleContacts,
          totalContactsInGroup,
          optedOutInGroup,
          hint:
            totalContactsInGroup > 0
              ? 'Contacts table me Opt-out = No karo, fir campaign send karo.'
              : 'Contacts page me contact assign karo is group me, fir campaign send karo.',
        },
      });
    }
    campaign.status = 'running';
    campaign.scheduledAt = null;
    campaign.sent = 0;
    campaign.failed = 0;
    campaign.totalContacts = 0;
    campaign.lastError = '';
    await campaign.save();
    setImmediate(() => runCampaignSendJob(campaign._id, req.clientId).catch(console.error));
    return ok(res, { campaign }, 'Campaign send started');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
exports.analyticsOverview = async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const [agg] = await WaMessage.aggregate([
      { $match: { userId: uid, direction: 'outbound' } },
      { $group: { _id: null, total: { $sum: 1 }, sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
    ]);
    const t = agg || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    const outbound = t.total || 0;
    return ok(res, { totalMessages: outbound, deliveredPercent: outbound ? Math.min(100, Math.round(((t.delivered + t.read + t.sent) / outbound) * 100)) : 0, readPercent: outbound ? Math.min(100, Math.round((t.read / outbound) * 100)) : 0, failedPercent: outbound ? Math.round((t.failed / outbound) * 100) : 0 }, 'Overview');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.analyticsCampaigns = async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const campaigns = await WaCampaign.find({ userId: uid }).sort({ createdAt: -1 }).limit(50).select('name status totalContacts sent delivered read failed createdAt');
    return ok(res, { campaigns }, 'Campaign stats');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.analyticsTimeline = async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const since = new Date(); since.setDate(since.getDate() - 30);
    const rows = await WaMessage.aggregate([
      { $match: { userId: uid, direction: 'outbound', createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return ok(res, { timeline: rows.map((r) => ({ date: r._id, messages: r.count })) }, 'Timeline');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

// ── INBOX ─────────────────────────────────────────────────────────────────────
exports.listConversations = async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const conversations = await WaConversation.find({ userId: uid }).sort({ lastMessageAt: -1 });
    return ok(res, { conversations }, 'Conversations');
  } catch (e) { return fail(res, e.message || 'Failed', 500); }
};

exports.getMessages = async (req, res) => {
  try {
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const conv = await WaConversation.findOne({ _id: req.params.id, userId: uid });
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
    const uid = new mongoose.Types.ObjectId(String(req.clientId));
    const conv = await WaConversation.findOne({ _id: req.params.id, userId: uid });
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
