# FCM Notification System - Architecture Overview

## System Diagram

```
┌─────────────┐
│  Flutter    │
│   Mobile    │
└──────┬──────┘
       │ (1) Register Token + JWT
       │ (2) Receive Notifications
       │
       ├─→ /api/notifications/register-token
       ├─→ /api/notifications/send-navigation
       └─→ OnMessage Listener (FCM)
       
       │
       ▼
┌─────────────────────────────────────┐
│   Express.js Backend (Node.js)      │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │  Authentication Middleware      │ │
│ │  (JWT validation)               │ │
│ └────────────┬────────────────────┘ │
│              │                       │
│ ┌────────────▼────────────────────┐ │
│ │  Rate Limiter Middleware        │ │
│ │  (10 req/min per user)          │ │
│ └────────────┬────────────────────┘ │
│              │                       │
│ ┌────────────▼────────────────────┐ │
│ │  Notification Routes            │ │
│ │  - register-token              │ │
│ │  - send-to-user                │ │
│ │  - send-batch                  │ │
│ │  - send-navigation             │ │
│ └────────────┬────────────────────┘ │
│              │                       │
│ ┌────────────▼────────────────────┐ │
│ │  Validation (Zod)              │ │
│ │  Input sanitization            │ │
│ └────────────┬────────────────────┘ │
│              │                       │
│ ┌────────────▼────────────────────┐ │
│ │  FCM Service (TypeScript)       │ │
│ │  - Token caching               │ │
│ │  - Access token refresh        │ │
│ │  - Error handling              │ │
│ │  - Auto-cleanup of stale       │ │
│ │    tokens                       │ │
│ └────────────┬────────────────────┘ │
│              │                       │
└──────────────┼───────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
  ┌──────────┐    ┌────────────────┐
  │ MongoDB  │    │ Firebase Cloud │
  │ Cluster  │    │  Messaging API │
  │          │    │                │
  │ Device   │    │ HTTP v1 API    │
  │ Tokens   │    │ (google.auth)  │
  │ Storage  │    └────────────────┘
  └──────────┘           │
       │                 │
       └─────────────────┘
                │
                ▼
        ┌──────────────┐
        │  FCM Service │
        │  Servers     │
        └──────────────┘
                │
                ▼
        ┌──────────────┐
        │ Device Queues│
        │ (APNS, GCM)  │
        └──────────────┘
```

---

## Core Components

### 1. **Authentication Layer**
- **Location:** `middleware/`, Route middleware
- **Purpose:** Validate JWT tokens, extract user ID
- **Responsibility:** Ensure only authenticated users register/send tokens
- **Integration:** Custom middleware in routes (replace with your auth)

### 2. **Rate Limiting**
- **Location:** `middleware/rateLimiter.ts`
- **Purpose:** Prevent abuse; limit requests per user
- **Limits:**
  - Register: 50 req/15 min per user
  - Send: 10 req/1 min per user
  - Batch: 5 req/1 min per user
- **Behavior:** Returns 429 on exceeded; skips for admin users

### 3. **Validation Layer** (Zod)
- **Location:** `utils/fcmValidation.ts`
- **Purpose:** Type-safe input validation
- **Schemas:**
  - `registerTokenSchema`: token + deviceType + optional deviceName
  - `sendNotificationSchema`: userId, title, body, optional data
  - `sendBatchSchema`: tokens array, title, body, data
  - `sendDataWithPayloadSchema`: Flutter-specific navigation data
- **Behavior:** Returns 400 with detailed errors on validation failure

### 4. **FCM Service** (TypeScript)
- **Location:** `services/fcmService.ts`
- **Purpose:** Core FCM HTTP v1 API communication
- **Features:**
  - Dual credential loading (file + base64)
  - Automatic access token caching + refresh
  - Single and batch notification sending
  - Automatic stale token invalidation
  - Structured logging with Pino
- **Error Handling:**
  - UNREGISTERED → auto-invalidate + remove
  - INVALID_ARGUMENT → auto-invalidate
  - MISMATCHED_CREDENTIAL → auto-invalidate + alert
  - Retry logic with exponential backoff
- **Batch Processing:** 100 tokens/batch by default

### 5. **Data Model** (MongoDB + Mongoose)
- **Location:** `models/DeviceToken.ts`
- **Schema:**
  - `userId`: Reference to User
  - `token`: FCM device token (unique)
  - `deviceType`: android | ios | web
  - `deviceName`: User-friendly name
  - `isActive`: Boolean flag
  - `invalidatedAt`: Date (for TTL cleanup)
  - `invalidReason`: UNREGISTERED | INVALID_ARGUMENT | MISMATCHED_CREDENTIAL
  - `lastUsedAt`: Track usage
  - `fcmResponseMetadata`: Store FCM response info
- **Indexes:**
  - Primary: userId, token
  - Compound: (userId, isActive), (token, isActive), (isActive, lastUsedAt)
  - TTL: Automatically delete after 90 days if invalidated
- **Methods:**
  - `invalidate()`: Mark token as inactive
  - `markAsUsed()`: Update lastUsedAt
  - `cleanupInvalidTokens()`: Batch delete old inactive tokens

### 6. **Notification Controller** (TypeScript)
- **Location:** `routes/notificationController.ts`
- **Endpoints:**
  - `registerToken()`: Upsert device token
  - `getUserTokens()`: Fetch active tokens for user
  - `unregisterToken()`: Hard delete token
  - `sendToUser()`: Send to all user's active tokens
  - `sendBatch()`: Send to multiple tokens
  - `sendDataOnly()`: Send data payload (no UI notification)
  - `sendWithNavigation()`: Flutter deep-linking support
  - `getStats()`: Token statistics (admin)
  - `cleanupInvalidTokens()`: Manual cleanup trigger (admin)
- **Error Handling:** Centralized via `handleError()` utility
- **Response Format:** Consistent { success, message, data/error }

### 7. **Scheduled Jobs** (Node-Cron)
- **Location:** `jobs/tokenCleanupJob.ts`
- **Jobs:**
  1. **Daily Cleanup** (2 AM UTC)
     - Deletes tokens invalidated >90 days ago
     - Preserves active tokens indefinitely
  2. **Weekly Stats** (Sunday 1 AM UTC)
     - Logs token statistics for monitoring
     - Useful for trends/alerting
  3. **Hourly Inactive Cleanup** (optional)
     - Removes tokens not used in 30 days
     - Prevents token database bloat
- **Graceful Shutdown:** All jobs stop cleanly on server shutdown

### 8. **Error Handling** (Centralized)
- **Location:** `utils/fcmErrors.ts`
- **Custom Errors:**
  - `FcmError`: Base error class
  - `ValidationError` (400): Schema/input validation
  - `NotFoundError` (404): Resource not found
  - `UnauthorizedError` (401): Auth required
  - `FcmAuthError` (500): FCM credential issues
  - `RateLimitError` (429): Too many requests
- **Handler:** `handleError()` distinguishes error types, logs safely

### 9. **Logging** (Pino)
- **Location:** Configured in each module
- **Levels:** debug | info | warn | error
- **Format:** JSON in production, pretty-printed in dev
- **Security:** Never logs full tokens (only suffix)
- **Context:** Always includes userId, request path, error details

---

## Data Flow Diagrams

### Registration Flow

```
Client                 Backend              MongoDB            FCM
  │                      │                    │                 │
  ├─ POST /register-token (JWT, token, type)─┤                 │
  │                      │                    │                 │
  │                  ┌───▼────┐               │                 │
  │                  │ Auth   │               │                 │
  │                  │ Check  │               │                 │
  │                  └───┬────┘               │                 │
  │                      │                    │                 │
  │                  ┌───▼───────┐            │                 │
  │                  │ Validate   │           │                 │
  │                  │ (Zod)      │           │                 │
  │                  └───┬───────┘            │                 │
  │                      │                    │                 │
  │                  ┌───▼──────────────┐     │                 │
  │                  │ Check existing   │     │                 │
  │                  │ token            │     │                 │
  │                  └───┬──────────────┘     │                 │
  │                      │                    │                 │
  │                  ┌───▼──────────────────┐ │                 │
  │                  │ Upsert/Create        │─┼────────────────▶│
  │                  │ DeviceToken          │─┼─────────────────┤
  │                  └─────┬────────────────┘ │                 │
  │                        │      (saved)     │                 │
  │◀─ 201 { tokenId }──────┤                  │                 │
```

### Notification Send Flow

```
Client/Admin           Backend              MongoDB            FCM
  │                      │                    │                 │
  ├─ POST /send-to-user ──┤                   │                 │
  │   (JWT, userId, title,body, data)        │                 │
  │                      │                    │                 │
  │                  ┌───▼────┐               │                 │
  │                  │ Auth +  │              │                 │
  │                  │ RateLimit               │                 │
  │                  └───┬────┘               │                 │
  │                      │                    │                 │
  │                  ┌───▼────────────┐       │                 │
  │                  │ Validate input │       │                 │
  │                  │ (Zod)          │       │                 │
  │                  └───┬────────────┘       │                 │
  │                      │                    │                 │
  │                  ┌───▼──────────────────┐ │                 │
  │                  │ Query active tokens  │─┼────────────────▶│
  │                  │ for userId           │◀┼─ (results)─────┤
  │                  └───┬──────────────────┘ │                 │
  │                      │                    │                 │
  │                  ┌───▼──────────────────┐ │                 │
  │                  │ For each token:      │ │                 │
  │                  │ - Get access token   │─┼───────────────┐ │
  │                  │   (cached)           │ │               │ │
  │                  │ - POST to FCM        │─┼───────────────┼─┼──────────▶
  │                  │                      │ │               │ │
  │                  │ On error:            │ │               │ │
  │                  │ - If UNREGISTERED    │ │               │ │
  │                  │   → invalidate       │─┼─ (update)─────┤ │
  │                  └─────┬────────────────┘ │                 │
  │                        │                  │                 │
  │◀─ 200 {sent, failed}───┤                  │                 │
```

### Auto-Cleanup Flow

```
Scheduled Job          Backend              MongoDB            
  │                      │                    │                 
  ├─ Cron trigger ──────▶│ (2 AM UTC)        │                 
  │  (daily)             │                    │                 
  │                      │                    │                 
  │                  ┌───▼──────────────────┐ │                 
  │                  │ Query tokens where:  │ │                 
  │                  │ - isActive = false   │ │                 
  │                  │ - invalidatedAt      │─┼────────────────▶│
  │                  │   < 90 days ago      │◀┼─ (results)─────┤
  │                  └─────┬────────────────┘ │                 
  │                        │                  │                 
  │                  ┌─────▼───────────────┐  │                 
  │                  │ Delete all results  │──┼─ (delete)──────▶│
  │                  │ (batch operation)   │  │                 
  │                  └────────┬────────────┘  │                 
  │                           │               │                 
  │                  ┌────────▼──────────┐    │                 
  │                  │ Log success:      │    │                 
  │                  │ "Deleted X tokens"│    │                 
  │                  └───────────────────┘    │                 
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime |
| **Language** | TypeScript | Type safety, compilation |
| **Framework** | Express.js | HTTP server, routing |
| **Database** | MongoDB + Mongoose | Token storage, indexing |
| **Validation** | Zod | Input validation, schemas |
| **Security** | Helmet | Security headers |
| **Rate Limiting** | express-rate-limit | Request throttling |
| **Logging** | Pino | Structured logging |
| **FCM SDK** | google-auth-library + axios | HTTP v1 API, auth |
| **Scheduling** | node-cron | Recurring jobs |
| **HTTP Client** | axios | FCM API calls |

---

## Credential Loading Strategy

### File-Based (Development)

```
service-account.json (local)
        │
        ├─ GOOGLE_APPLICATION_CREDENTIALS env var
        │
        ▼
    fcmService reads file
        │
        ├─ JSON.parse()
        │
        ▼
    google-auth-library.fromJSON()
        │
        ├─ Credentials ready
```

### Base64-Encoded (Production/Docker)

```
service-account.json (secret management)
        │
        ├─ base64 encode
        │
        ├─ FCM_SERVICE_ACCOUNT_B64 env var
        │
        ▼
    fcmService.initialize()
        │
        ├─ Buffer.from(base64, 'base64').toString('utf-8')
        │
        ├─ JSON.parse()
        │
        ▼
    google-auth-library.fromJSON()
        │
        ├─ Credentials ready
```

---

## State Transitions

### Device Token Lifecycle

```
┌─────────────┐
│  Registered │
│  isActive=T │
│             │
└──────┬──────┘
       │
       ├─ Used for notifications
       │  lastUsedAt updated
       │
       ├─ FCM returns UNREGISTERED/INVALID
       │
       ▼
┌─────────────────────┐
│   Invalidated       │
│   isActive=F        │
│   invalidatedAt=NOW │
│   reason=UNREGIST.. │
└──────┬──────────────┘
       │
       ├─ Keep in DB for 90 days
       │  (TTL index)
       │
       ├─ Daily cleanup job runs
       │
       ▼
┌─────────────┐
│  Deleted    │
│  Removed    │
│  from DB    │
└─────────────┘
```

---

## Scaling Considerations

### Horizontal Scaling (Multiple Servers)

```
Load Balancer
    │
    ├─ API Server 1 ──┐
    │   (stateless)   ├─ Same MongoDB
    ├─ API Server 2 ──┤   (single source)
    │                 │
    └─ API Server 3 ──┘
```

**Considerations:**
- All servers share MongoDB
- Token caching is per-process (acceptable)
- Cleanup jobs run on all servers (idempotent delete)
- Rate limiting per-user (works across servers)

### Vertical Scaling (Larger Instances)

```
Larger Server
    │
    ├─ Increased MONGODB_POOL_SIZE
    ├─ Increased FCM_BATCH_SIZE
    ├─ More cron job parallelism
    │
    └─ Better token throughput
```

### Database Optimization

```
Current: Collection indexes (Mongoose)
    │
    ├─ By userId
    ├─ By token
    ├─ By isActive
    ├─ Compound (userId + isActive)
    │
    └─ Suitable for 1M+ tokens
```

**For 10M+ tokens:**
- Add sharding by userId
- Archive old invalidated tokens
- Separate read replicas for stats queries

---

## Monitoring & Observability

### Key Metrics

```
1. Token Registration Rate (tokens/min)
   - Target: 10-100 during peak hours
   - Alert: >500 (possible abuse)

2. Notification Send Success Rate (%)
   - Target: >98%
   - Alert: <95% (FCM issues)

3. Error Rates by Type
   - UNREGISTERED: Normal decay
   - INVALID_ARGUMENT: Should be 0
   - MISMATCHED_CREDENTIAL: Should be 0

4. FCM API Response Time (ms)
   - Target: <300ms
   - Alert: >1000ms (service degradation)

5. Rate Limit Hits (per hour)
   - Normal: 1-10
   - Alert: >100 (indicates abuse or bad client retry logic)

6. Cleanup Job Performance
   - Deleted tokens per run
   - Execution duration
   - Success/failure status
```

---

## Disaster Recovery

### Token Loss Scenario

**Problem:** MongoDB corruption/loss

**Impact:** Users must re-register devices

**Recovery:**
1. Restore from backup
2. Device tokens will re-register via `/register-token`
3. No notification loss (FCM has device tokens independently)

### FCM Service Outage

**Problem:** FCM API unavailable

**Impact:** Cannot send new notifications (queued messages lost)

**Recovery:**
1. Firebase handles this; will retry
2. Consider implementing notification queue (Redis/SQS)
3. Retry mechanism with exponential backoff

### Credential Expiration

**Problem:** Service account key expires

**Impact:** FCM authentication fails

**Recovery:**
1. Generate new key in Firebase Console
2. Update `GOOGLE_APPLICATION_CREDENTIALS` or base64 env var
3. Restart service
4. Automatic token refresh on next send

---

## Security Model

```
┌─ Public Internet ────────────────┐
│                                  │
│  ┌─ Client (Flutter App) ────┐   │
│  │ (Device Token from FCM)   │   │
│  └───────┬──────────────────┘    │
│          │                        │
│    ┌─────▼────────────┐          │
│    │ JWT Token (Auth) │          │
│    │ (from login)     │          │
│    └────────┬────────┘           │
│             │                     │
│  ┌──────────▼────────────────┐   │
│  │ /api/notifications/*      │   │
│  │ (HTTPS only)              │   │
│  └──────────┬──────────────┘    │
└─────────────┼────────────────────┘
              │
┌─────────────▼──────────────────────┐
│ Backend (Node.js + Express)        │
│                                    │
│ ┌─ Middleware ───────────────────┐│
│ │ 1. HTTPS/TLS                  ││
│ │ 2. Rate Limiting              ││
│ │ 3. JWT Validation             ││
│ │ 4. Helmet Security Headers    ││
│ │ 5. CORS Whitelist             ││
│ └─────────────────────────────┘ │
│                                 │
│ ┌─ Application ────────────────┐│
│ │ 1. Zod Input Validation     ││
│ │ 2. Role checks (admin)      ││
│ │ 3. User ownership checks    ││
│ │ 4. Sensitive data masking   ││
│ └─────────────────────────────┘│
│                                 │
│ ┌─ Data Layer ──────────────────┐│
│ │ 1. MongoDB connection auth   ││
│ │ 2. Encrypted credentials    ││
│ │ 3. Indexed queries          ││
│ └─────────────────────────────┘│
└─────────────────────────────────┘
              │
┌─────────────▼──────────────────────┐
│ External Services                  │
│                                    │
│ ┌─ Firebase (Service Account)────┐│
│ │ (Secured with private key)     ││
│ └────────────────────────────────┘│
│                                    │
│ ┌─ MongoDB (TLS + Auth)──────────┐│
│ │ (Connection string in env)     ││
│ └────────────────────────────────┘│
└────────────────────────────────────┘
```

---

## Summary

**This architecture provides:**
- ✅ Type safety (TypeScript)
- ✅ Production-ready error handling
- ✅ Automatic stale token cleanup
- ✅ Rate limiting to prevent abuse
- ✅ Structured logging for observability
- ✅ Flexible credential loading
- ✅ Flutter deep-linking support
- ✅ Scalable to millions of tokens
- ✅ Security by default (Helmet, CORS, validation)
- ✅ Clear separation of concerns
