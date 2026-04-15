require('dotenv').config();
const http = require('http');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4N2Y3MWI3MjZmNzIxMjQzODhmNjRhOCIsInVzZXJUeXBlIjoiY2xpZW50IiwiaWF0IjoxNzc2MjMzMjkxLCJleHAiOjE3NzYzMTk2OTF9.Slef8m_mJdGwC484pKjFSPO7Oqe6m6_5eeCJHtLPnfs';
const BASE = 'http://localhost:4000/api/v1/whatsai';

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost', port: 4000,
      path: '/api/v1/whatsai' + path,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve({ status: res.statusCode, success: json.success, data: json });
        } catch {
          resolve({ status: res.statusCode, success: false, data: d.substring(0, 100) });
        }
      });
    });
    r.on('error', e => resolve({ status: 0, success: false, data: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

async function runTests() {
  const results = [];
  let pass = 0, fail = 0;

  async function test(name, method, path, body) {
    const r = await req(method, path, body);
    const ok = r.status >= 200 && r.status < 500 && r.success !== false;
    if (ok) pass++; else fail++;
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} [${r.status}] ${method} ${path} — ${name}`);
    if (!ok) console.log(`   Response: ${JSON.stringify(r.data).substring(0, 150)}`);
    results.push({ name, method, path, status: r.status, ok });
    return r;
  }

  console.log('\n========== WhatsAi API Test ==========\n');

  // Auth/Connect
  console.log('--- Auth/Connect ---');
  await test('Get Profile', 'GET', '/profile');
  await test('Connect WhatsApp (validation)', 'POST', '/connect', { whatsappPhoneNumberId: '123', whatsappAccessToken: 'short' });

  // Contacts
  console.log('\n--- Contacts ---');
  const contacts = await test('List Contacts', 'GET', '/contacts');
  await test('Create Contact', 'POST', '/contacts', { name: 'Test User', phone: '919999999999' });
  const contactId = contacts.data?.data?.contacts?.[0]?._id;
  if (contactId) {
    await test('Update Contact', 'PATCH', `/contacts/${contactId}`, { name: 'Test Updated' });
  } else {
    console.log('⚠️  SKIP Update Contact — no contact ID');
  }

  // Contact Groups
  console.log('\n--- Contact Groups ---');
  const groups = await test('List Groups', 'GET', '/contacts/groups');
  await test('Create Group', 'POST', '/contacts/groups', { name: 'Test Group' });
  const groupId = groups.data?.data?.groups?.[0]?._id;
  if (groupId) {
    await test('Delete Group', 'DELETE', `/contacts/groups/${groupId}`);
  } else {
    console.log('⚠️  SKIP Delete Group — no group ID');
  }

  // Templates
  console.log('\n--- Templates ---');
  await test('List Templates', 'GET', '/templates');
  await test('List Meta Approved Templates', 'GET', '/templates/meta-approved');
  const tmpl = await req('GET', '/templates');
  const tmplId = tmpl.data?.data?.templates?.[0]?._id;
  if (tmplId) {
    await test('Get Template', 'GET', `/templates/${tmplId}`);
    await test('Update Template', 'PATCH', `/templates/${tmplId}`, { name: 'Updated' });
  } else {
    console.log('⚠️  SKIP Get/Update Template — no template ID');
  }
  await test('Create Template', 'POST', '/templates', { name: 'api_test', whatsappTemplateName: 'hello_world', languageCode: 'en_US', bodyPreview: 'Hello World' });

  // Campaigns
  console.log('\n--- Campaigns ---');
  const camps = await test('List Campaigns', 'GET', '/campaigns');
  const campId = camps.data?.data?.campaigns?.[0]?._id;
  if (campId) {
    await test('Get Campaign', 'GET', `/campaigns/${campId}`);
  } else {
    console.log('⚠️  SKIP Get Campaign — no campaign ID');
  }

  // Analytics
  console.log('\n--- Analytics ---');
  await test('Analytics Overview', 'GET', '/analytics/overview');
  await test('Analytics Campaigns', 'GET', '/analytics/campaigns');
  await test('Analytics Timeline', 'GET', '/analytics/timeline');

  // Inbox
  console.log('\n--- Inbox ---');
  const convs = await test('List Conversations', 'GET', '/inbox/conversations');
  const convId = convs.data?.data?.conversations?.[0]?._id;
  if (convId) {
    await test('Get Messages', 'GET', `/inbox/conversations/${convId}/messages`);
    await test('Assign Conversation', 'PATCH', `/inbox/conversations/${convId}/assign`, { assignedAgent: 'agent1' });
  } else {
    console.log('⚠️  SKIP Get Messages/Assign — no conversation ID');
  }

  // Bot Flow
  console.log('\n--- Bot Flow ---');
  await test('Get Bot Flow', 'GET', '/bot/flow');
  await test('Save Bot Flow', 'POST', '/bot/flow', { triggerKeyword: 'hi', nodes: [{ id: 'n1', type: 'message', content: 'Hello!', nextNodeId: '', options: [] }] });

  // Webhook
  console.log('\n--- Webhook ---');
  const wh = await req('GET', '/../../whatsai/webhook?hub.mode=subscribe&hub.verify_token=myverifytoken123&hub.challenge=test123');
  console.log(`${wh.status === 200 ? '✅' : '❌'} [${wh.status}] GET /webhook/verify — Webhook Verify`);

  console.log('\n========== RESULTS ==========');
  console.log(`✅ Passed: ${pass}`);
  console.log(`❌ Failed: ${fail}`);
  console.log(`📊 Total:  ${pass + fail}`);
}

runTests().catch(console.error);
