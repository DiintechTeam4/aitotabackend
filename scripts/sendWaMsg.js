require('dotenv').config();
const axios = require('axios');

const token = 'EAAN3dRrsgYsBRP92b3eJTV52F5KnDST45fkcZAvHIUJgNyy6ezZA0Mv82HpskuZAQW3WqIhaV9KpSTM1jCdkr6NdwkZAUubFuKc2zmtEvz71xSd305X5lIHZB0kpdAcap9AvQNqI1IHBOcBCPZCUyJzFjashhtwDl08EjOZArqHfy6himdCyXESb5C9bW2pNAdVI3aqCQvvURhHmAclUj3m5JBHJ1WnxsaK1R1bzZAhJKqeDU4tLHXz2bCqFb4flz8u5Lc2jQo754wBkP4VwRUlFHa7wQwZDZD';
const phoneId = '790783224112773';
const to = '919918309983';
const msg = 'Welcome to *AiTota* - AI-Powered Business Automation!\n\nFounded by *Vijay Kumar Singh*, AiTota helps businesses grow with:\n- AI Voice Agents\n- WhatsApp Automation\n- Outbound Calling Campaigns\n- Lead Management and Analytics\n\nReply with:\n1 - About AiTota\n2 - Book a Demo\n3 - Pricing Plans\n4 - Contact Support';

axios.post(
  `https://graph.facebook.com/v19.0/${phoneId}/messages`,
  { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: msg } },
  { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
).then(r => {
  console.log('SUCCESS:', JSON.stringify(r.data));
}).catch(e => {
  console.log('FAILED:', JSON.stringify(e.response?.data || e.message));
});
