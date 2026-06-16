# FCM Notification API - Testing Guide

## Setup

Ensure you have:
- Node.js 18+
- MongoDB running locally or accessible
- Valid Firebase project credentials
- `npm install` completed

## Environment Setup

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill in your Firebase credentials:

```bash
# Option A: File path
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Option B: Base64-encoded (for Docker/K8s)
FCM_SERVICE_ACCOUNT_B64=$(cat service-account.json | base64)
```

## Development Server

```bash
npm run dev
```

Server starts on `http://localhost:3000`

---

## API Endpoints

### 1. Register Device Token

**Endpoint:** `POST /api/notifications/register-token`

**Authentication:** Required (JWT)

**Rate Limit:** 50 requests per 15 minutes per user

**Request Body:**
```json
{
  "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
  "deviceType": "android",
  "deviceName": "Pixel 6 Pro"
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/register-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
    "deviceType": "android",
    "deviceName": "Pixel 6 Pro"
  }'
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Device token registered successfully",
  "tokenId": "66abc1234def567890123456"
}
```

**Error Responses:**
- `400`: Missing/invalid fields
- `401`: Missing authentication
- `429`: Rate limit exceeded

---

### 2. Get My Device Tokens

**Endpoint:** `GET /api/notifications/my-tokens`

**Authentication:** Required (JWT)

**cURL:**
```bash
curl -X GET http://localhost:3000/api/notifications/my-tokens \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "66abc1234def567890123456",
      "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
      "deviceType": "android",
      "deviceName": "Pixel 6 Pro",
      "lastUsedAt": "2025-06-13T10:30:00.000Z",
      "createdAt": "2025-06-13T09:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

### 3. Unregister Device Token

**Endpoint:** `DELETE /api/notifications/unregister-token`

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c"
}
```

**cURL:**
```bash
curl -X DELETE http://localhost:3000/api/notifications/unregister-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c"
  }'
```

---

### 4. Send to User

**Endpoint:** `POST /api/notifications/send-to-user`

**Authentication:** Required (JWT, typically admin)

**Rate Limit:** 10 requests per minute

**Request Body:**
```json
{
  "userId": "66abc1234def567890123456",
  "title": "New Contest Available!",
  "body": "Check out our latest photography contest.",
  "data": {
    "contestId": "66xyz9876abc321def654987",
    "action": "OPEN_CONTEST"
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/send-to-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "66abc1234def567890123456",
    "title": "New Contest Available!",
    "body": "Check out our latest photography contest.",
    "data": {
      "contestId": "66xyz9876abc321def654987",
      "action": "OPEN_CONTEST"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Notification sent",
  "sent": 2,
  "failed": 0
}
```

---

### 5. Send Batch Notifications

**Endpoint:** `POST /api/notifications/send-batch`

**Authentication:** Required (JWT, typically admin)

**Rate Limit:** 5 requests per minute

**Request Body:**
```json
{
  "tokens": [
    "token1_here",
    "token2_here",
    "token3_here"
  ],
  "title": "Urgent: System Maintenance",
  "body": "System will be down for 2 hours starting 2:00 AM UTC",
  "data": {
    "type": "MAINTENANCE",
    "duration": "2 hours"
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/send-batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "tokens": ["token1", "token2", "token3"],
    "title": "System Maintenance",
    "body": "Server will restart at 2:00 AM UTC",
    "data": {
      "type": "MAINTENANCE"
    }
  }'
```

---

### 6. Send Data-Only Notification

**Endpoint:** `POST /api/notifications/send-data-only`

**Authentication:** Required (JWT)

**Rate Limit:** 10 requests per minute

**Use Case:** No visible notification, just data payload (e.g., silent data sync)

**Request Body:**
```json
{
  "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
  "data": {
    "syncType": "user_profile",
    "timestamp": "2025-06-13T10:30:00Z"
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/send-data-only \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
    "data": {
      "syncType": "user_profile",
      "timestamp": "2025-06-13T10:30:00Z"
    }
  }'
```

---

### 7. Send Navigation Notification (Flutter-specific)

**Endpoint:** `POST /api/notifications/send-navigation`

**Authentication:** Required (JWT)

**Rate Limit:** 10 requests per minute

**Use Case:** Send navigation data for deep linking in Flutter app

**Request Body:**
```json
{
  "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
  "data": {
    "eventId": "66xyz9876abc321def654987"
  },
  "route": "/contest-detail",
  "action": "OPEN_CONTEST",
  "metadata": {
    "source": "notification",
    "timestamp": "2025-06-13T10:30:00Z"
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/send-navigation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "token": "fYdz1-LJRLu4h8N-aB3cXYzM9pqRsTu_vWxY1Za2b3c",
    "data": {
      "contestId": "66xyz9876abc321def654987"
    },
    "route": "/contest-detail",
    "action": "OPEN_CONTEST"
  }'
```

**Flutter Integration Example:**
```dart
FirebaseMessaging.onMessage.listen((RemoteMessage message) {
  final data = message.data;
  final route = data['route'];
  final action = data['action'];
  
  if (route != null) {
    // Deep link to route with metadata
    navigatorKey.currentState?.pushNamed(
      route,
      arguments: {
        'action': action,
        'metadata': data['metadata'],
      },
    );
  }
});
```

---

### 8. Get Statistics (Admin Only)

**Endpoint:** `GET /api/notifications/stats`

**Authentication:** Required (JWT with admin role)

**cURL:**
```bash
curl -X GET http://localhost:3000/api/notifications/stats \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalTokens": 1250,
    "activeTokens": 1180,
    "inactiveTokens": 70,
    "byDeviceType": {
      "android": 650,
      "ios": 530,
      "web": 0
    }
  }
}
```

---

### 9. Manual Cleanup (Admin Only)

**Endpoint:** `POST /api/notifications/cleanup`

**Authentication:** Required (JWT with admin role)

**cURL:**
```bash
curl -X POST http://localhost:3000/api/notifications/cleanup \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Invalid tokens cleaned up successfully",
  "deletedCount": 23
}
```

---

## Common Errors

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Authentication required",
  "code": "UNAUTHORIZED"
}
```

**Fix:** Include valid JWT in `Authorization: Bearer YOUR_TOKEN` header

### 400 Validation Error
```json
{
  "success": false,
  "error": "Request validation failed",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "field": "deviceType",
      "message": "deviceType must be \"android\", \"ios\", or \"web\"",
      "code": "invalid_enum_value"
    }
  ]
}
```

### 429 Rate Limited
```json
{
  "success": false,
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 1623585000000
}
```

**Fix:** Wait before retrying

### 500 FCM Error
```json
{
  "success": false,
  "error": "FCM authentication failed",
  "code": "FCM_AUTH_ERROR"
}
```

**Fix:** Verify credentials in `.env`

---

## Testing Checklist

- [ ] Register token (single device)
- [ ] Get tokens (verify registered)
- [ ] Send to user (verify delivery)
- [ ] Send batch (test multiple tokens)
- [ ] Send data-only (silent notification)
- [ ] Send navigation (Flutter deep linking)
- [ ] Unregister token (cleanup)
- [ ] Rate limiting (send >10 in 1 min)
- [ ] Invalid credentials (verify error handling)
- [ ] Admin stats endpoint
- [ ] Cleanup invalid tokens

---

## Performance Notes

- Token registration: <100ms
- Notification send (single): <500ms
- Batch send (100 tokens): <3s
- Rate limits prevent abuse while allowing normal usage
- Automatic cleanup runs daily at 2 AM UTC

---

## Firebase Console Testing

Alternatively, test via Firebase Console:

1. Go to Firebase Console → Cloud Messaging
2. Create new campaign
3. Select "Send test message"
4. Paste device token
5. Click "Send"

This confirms your FCM setup is working correctly.

---

## Support

For issues:
- Check `.env` credentials
- Verify JWT tokens are valid
- Review server logs: `npm run dev`
- Check Firebase service account has Messaging API enabled
