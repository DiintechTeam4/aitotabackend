# Backend Campaign Calling System

This document explains the new backend-based campaign calling system that handles all call functionality server-side.

## Overview

The backend calling system moves all call logic from the frontend to the backend, providing:

- **Centralized call management**
- **Better error handling**
- **Automatic call logging**
- **Progress tracking**
- **Rate limiting**
- **Background processing**

## API Endpoints

### 1. Start Campaign Calling

```http
POST /api/v1/client/campaigns/:id/start-calling
```

**Request Body:**

```json
{
  "agentId": "agent_id_here",
  "delayBetweenCalls": 2000
}
```

**Response:**

```json
{
  "success": true,
  "message": "Campaign calling started",
  "data": {
    "campaignId": "campaign_id",
    "totalContacts": 50,
    "status": "started"
  }
}
```

### 2. Stop Campaign Calling

```http
POST /api/v1/client/campaigns/:id/stop-calling
```

**Response:**

```json
{
  "success": true,
  "message": "Campaign calling stopped",
  "data": {
    "campaignId": "campaign_id",
    "status": "stopped"
  }
}
```

### 3. Get Calling Status

```http
GET /api/v1/client/campaigns/:id/calling-status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "campaignId": "campaign_id",
    "isRunning": true,
    "totalContacts": 50,
    "progress": {
      "campaignId": "campaign_id",
      "totalContacts": 50,
      "currentIndex": 15,
      "completedCalls": 15,
      "successfulCalls": 14,
      "failedCalls": 1,
      "startTime": "2024-01-15T10:30:00.000Z",
      "isRunning": true,
      "lastCallTime": "2024-01-15T10:35:00.000Z"
    }
  }
}
```

### 4. Make Single Call

```http
POST /api/v1/client/campaigns/:id/make-call
```

**Request Body:**

```json
{
  "contactId": "contact_id_here",
  "agentId": "agent_id_here"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "uniqueId": "aidial-1234567890-abc123",
    "contact": {
      "_id": "contact_id",
      "name": "John Doe",
      "phone": "+1234567890"
    },
    "timestamp": "2024-01-15T10:30:00.000Z",
    "externalResponse": { ... }
  }
}
```

## How It Works

### 1. Call Initiation

- Frontend calls `/start-calling` endpoint
- Backend validates campaign, contacts, and agent
- Campaign status is set to `isRunning: true`
- Background calling process starts

### 2. Background Processing

- Calls are made sequentially with configurable delays
- Each call gets a unique ID for tracking
- Progress is tracked in memory and updated in real-time
- Call logs are automatically created in database

### 3. Progress Tracking

- Frontend polls `/calling-status` endpoint every 2 seconds
- Real-time progress updates including:
  - Current contact being called
  - Total calls completed
  - Success/failure counts
  - Last call timestamp

### 4. Call Completion

- Campaign automatically stops when all contacts are called
- Campaign status is set to `isRunning: false`
- Progress data is cleaned up after 1 hour

## Frontend Integration

### Using the BackendCampaignCalling Component

```jsx
import BackendCampaignCalling from "./BackendCampaignCalling";

// In your campaign details component
<BackendCampaignCalling
  campaign={selectedCampaign}
  selectedAgent={selectedAgentId}
/>;
```

### Manual API Integration

```javascript
// Start calling
const startCalling = async () => {
  const response = await fetch(
    `${API_BASE}/campaigns/${campaignId}/start-calling`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: selectedAgent,
        delayBetweenCalls: 2000,
      }),
    }
  );
  const result = await response.json();
};

// Poll for status
const pollStatus = async () => {
  const response = await fetch(
    `${API_BASE}/campaigns/${campaignId}/calling-status`
  );
  const result = await response.json();
  // Update UI with result.data.progress
};

// Stop calling
const stopCalling = async () => {
  const response = await fetch(
    `${API_BASE}/campaigns/${campaignId}/stop-calling`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
};
```

## Benefits

### 1. **Reliability**

- Server-side processing ensures calls continue even if frontend disconnects
- Automatic error handling and retry logic
- Database persistence of call logs

### 2. **Scalability**

- Multiple campaigns can run simultaneously
- Configurable rate limiting prevents API overload
- Background processing doesn't block other operations

### 3. **Monitoring**

- Real-time progress tracking
- Detailed call logs with metadata
- Success/failure statistics

### 4. **Security**

- API keys managed server-side
- Client authentication required for all operations
- No sensitive data exposed to frontend

## Configuration

### Rate Limiting

- Default delay between calls: 2 seconds
- Configurable via `delayBetweenCalls` parameter
- Prevents overwhelming external API

### Memory Management

- Progress data automatically cleaned up after 1 hour
- Active campaigns tracked in memory for performance
- Database used for persistent storage

### Error Handling

- Failed calls are logged but don't stop the campaign
- Network errors are handled gracefully
- Campaign status is updated on completion or error

## Migration from Frontend Calling

To migrate from the old frontend calling system:

1. **Replace frontend calling logic** with backend API calls
2. **Update UI components** to use the new endpoints
3. **Remove frontend call management** code
4. **Update progress tracking** to poll the status endpoint

The new system provides the same functionality with better reliability and scalability.
