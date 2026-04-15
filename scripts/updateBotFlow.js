require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const userId = new mongoose.Types.ObjectId('687f71b726f72124388f64a8');

  // Check existing
  const existing = await db.collection('wabotflows').findOne({ userId });
  console.log('Existing doc _id:', existing?._id);
  console.log('Existing nodes:', existing?.nodes?.length);
  console.log('Trigger:', existing?.triggerKeyword);

  const nodes = [
    { id: 'node_1', type: 'message', content: 'Welcome to *AiTota* - AI-Powered Business Automation!\n\nFounded by *Vijay Kumar Singh*, AiTota helps businesses grow with:\n- AI Voice Agents\n- WhatsApp Automation\n- Outbound Calling Campaigns\n- Lead Management and Analytics\n\nReply with:\n1 - About AiTota\n2 - Book a Demo\n3 - Pricing Plans\n4 - Contact Support', nextNodeId: 'node_2', options: [] },
    { id: 'node_2', type: 'menu', content: 'Please choose:\n\n1 - About AiTota\n2 - Book a Demo\n3 - Pricing Plans\n4 - Contact Support', nextNodeId: '', options: [{ label: 'About AiTota', value: '1', nextNodeId: 'node_about' }, { label: 'Book Demo', value: '2', nextNodeId: 'node_demo' }, { label: 'Pricing', value: '3', nextNodeId: 'node_pricing' }, { label: 'Support', value: '4', nextNodeId: 'node_support' }] },
    { id: 'node_about', type: 'message', content: 'About *AiTota*\n\nAiTota is an AI-powered automation platform founded by *Vijay Kumar Singh*.\n\n- AI Voice Agents: Handle customer calls 24/7\n- WhatsApp Bot: Auto replies and bulk campaigns\n- Outbound Campaigns: Reach thousands instantly\n- Analytics: Real-time performance insights\n\n100+ businesses trust AiTota!\nType 2 to book a free demo.', nextNodeId: '', options: [] },
    { id: 'node_demo', type: 'message', content: 'Book a Free Demo!\n\nEmail: aitotateam@gmail.com\nWebsite: https://aitota.com\n\nReply here and our team will contact you within 24 hours!\n\nFounded by Vijay Kumar Singh - We are committed to your growth.', nextNodeId: '', options: [] },
    { id: 'node_pricing', type: 'message', content: 'AiTota Pricing Plans\n\nBasic - Rs.999/month: 1000 AI credits, WhatsApp Bot\nProfessional - Rs.4999/month: 5500 AI credits, Voice Agents\nEnterprise - Rs.9999/month: 11000 AI credits, Custom Integration\n\nAll plans include free onboarding!\nEmail: aitotateam@gmail.com', nextNodeId: '', options: [] },
    { id: 'node_support', type: 'message', content: 'AiTota Support - Available 24/7!\n\nEmail: aitotateam@gmail.com\nWebsite: https://aitota.com\n\nFounded by Vijay Kumar Singh - Your success is our mission!', nextNodeId: '', options: [] }
  ];

  const result = await db.collection('wabotflows').updateOne(
    { userId },
    { $set: { triggerKeyword: 'hi', nodes, updatedAt: new Date() } }
  );
  console.log('Update result - matched:', result.matchedCount, '| modified:', result.modifiedCount);

  const saved = await db.collection('wabotflows').findOne({ userId });
  console.log('After update nodes:', saved?.nodes?.length);
  saved?.nodes?.forEach(n => console.log(' -', n.id, n.type));

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
