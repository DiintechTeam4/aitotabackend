const { scrapeJustDial, scrapeIndiaMart } = require('../services/scraperService');
const Contact = require('../models/Contacts');

exports.searchLeads = async (req, res) => {
  try {
    const { source, query, location, category, page = 1 } = req.query;
    const clientId = req.clientId || req.query.clientId;

    if (!query) return res.status(400).json({ success: false, message: 'query is required' });
    if (!source) return res.status(400).json({ success: false, message: 'source is required' });

    let result;
    if (source === 'justdial') {
      result = await scrapeJustDial({ query, location, category, page: parseInt(page) });
    } else if (source === 'indiamart') {
      result = await scrapeIndiaMart({ query, location, category, page: parseInt(page) });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid source. Use justdial or indiamart' });
    }

    res.json(result);
  } catch (error) {
    console.error('searchLeads error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveLead = async (req, res) => {
  try {
    const { lead, source } = req.body;
    const clientId = req.clientId;

    if (!lead || !lead.name) return res.status(400).json({ success: false, message: 'lead data required' });

    // Check if contact already exists
    const existing = await Contact.findOne({
      clientId,
      $or: [
        { phone: lead.phone, phone: { $ne: '' } },
        { name: lead.name, city: lead.city }
      ]
    });

    if (existing) {
      return res.json({ success: true, message: 'Contact already exists', contact: existing, duplicate: true });
    }

    const contact = await Contact.create({
      clientId,
      name: lead.name,
      phone: lead.phone || `NOPHONE_${Date.now()}`,
      email: lead.email || '',
    });

    res.json({ success: true, message: 'Contact saved', contact });
  } catch (error) {
    console.error('saveLead error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
