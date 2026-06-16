# FCM Implementation Checklist

## Phase 1: Setup & Dependencies

- [x] Update `package.json` with latest stable versions
- [x] Install dependencies: `npm install`
- [x] Add TypeScript support: `ts-node`, `@types/*`
- [x] Add rate limiting: `express-rate-limit`
- [x] Verify Firebase Admin SDK included (optional)

**Actions:**
```bash
npm install
npm run type-check
```

---

## Phase 2: Credential Configuration

- [ ] Obtain Firebase service account JSON from Console
- [ ] Choose credential strategy:
  - [ ] **File-based**: Set `GOOGLE_APPLICATION_CREDENTIALS` env var
  - [ ] **Base64**: Encode and set `FCM_SERVICE_ACCOUNT_B64`
- [ ] Create `.env` from `.env.example`
- [ ] Test credential loading: `npm run dev`
- [ ] Verify in logs: "FCM service initialized with project: xxx"

**Commands:**
```bash
# Option A: File
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Option B: Base64
export FCM_SERVICE_ACCOUNT_B64=$(cat service-account.json | base64)

# Test
npm run dev
# Look for: "FCM service initialized with project: your-project-id"
```

---

## Phase 3: Database Setup

- [ ] MongoDB connection string ready
- [ ] Test MongoDB connection
- [ ] Run migrations (auto via Mongoose schema)
- [ ] Verify indexes created:
  ```bash
  mongosh "your-mongodb-uri"
  > db.devicetokens.getIndexes()
  ```

---

## Phase 4: Build & Type Checking

- [ ] Type check passes:
  ```bash
  npm run type-check
  # Should have 0 errors
  ```
- [ ] Build succeeds:
  ```bash
  npm run build
  # Output in dist/
  ```
- [ ] No build errors or warnings

---

## Phase 5: Authentication Middleware Integration

- [ ] Add JWT authentication middleware to Express app
- [ ] Ensure `req.user._id` is set by auth middleware
- [ ] Test with valid JWT token:
  ```bash
  curl -H "Authorization: Bearer YOUR_JWT" \
    http://localhost:3000/api/notifications/register-token
  ```
- [ ] Verify 401 response without token

---

## Phase 6: Route Integration

- [ ] Import notification routes in main app:
  ```typescript
  import notificationRoutes from './routes/notifications';
  app.use('/api/notifications', notificationRoutes);
  ```
- [ ] Test health endpoint (no auth needed):
  ```bash
  curl http://localhost:3000/api/notifications/health
  ```

---

## Phase 7: Scheduled Jobs

- [ ] Add cleanup jobs to app startup:
  ```typescript
  import { startAllCleanupJobs } from './jobs/tokenCleanupJob';
  // Call after app initialization
  startAllCleanupJobs();
  ```
- [ ] Verify jobs start: look for "FCM scheduled jobs initialized" in logs
- [ ] Test manual cleanup endpoint:
  ```bash
  curl -X POST http://localhost:3000/api/notifications/cleanup \
    -H "Authorization: Bearer ADMIN_TOKEN"
  ```

---

## Phase 8: Client Testing (Flutter)

### Register Token

```dart
import 'package:firebase_messaging/firebase_messaging.dart';

final token = await FirebaseMessaging.instance.getToken();

final response = await http.post(
  Uri.parse('https://api.example.com/api/notifications/register-token'),
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $jwtToken',
  },
  body: jsonEncode({
    'token': token,
    'deviceType': Platform.isAndroid ? 'android' : 'ios',
    'deviceName': 'User Device',
  }),
);

if (response.statusCode == 201) {
  print('Token registered successfully');
} else {
  print('Failed to register token');
}
```

### Receive Notifications

```dart
// Foreground messages
FirebaseMessaging.onMessage.listen((RemoteMessage message) {
  print('Message received: ${message.notification?.title}');
  
  final data = message.data;
  if (data['route'] != null) {
    // Navigate to route
    Navigator.pushNamed(context, data['route']);
  }
});

// Background messages (requires top-level function)
void firebaseMessagingBackgroundHandler(RemoteMessage message) {
  print('Background message: ${message.notification?.title}');
}

FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
```

---

## Phase 9: API Testing (Server)

- [ ] **Register Token**
  ```bash
  curl -X POST http://localhost:3000/api/notifications/register-token \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d '{"token":"ABC123","deviceType":"android"}'
  # Expect: 201 with tokenId
  ```

- [ ] **Get My Tokens**
  ```bash
  curl -X GET http://localhost:3000/api/notifications/my-tokens \
    -H "Authorization: Bearer $JWT"
  # Expect: 200 with array of tokens
  ```

- [ ] **Send to User**
  ```bash
  curl -X POST http://localhost:3000/api/notifications/send-to-user \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d '{"userId":"USER_ID","title":"Test","body":"Hello"}'
  # Expect: 200 with sent count
  ```

- [ ] **Send Navigation**
  ```bash
  curl -X POST http://localhost:3000/api/notifications/send-navigation \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d '{
      "token":"ABC123",
      "data":{"eventId":"123"},
      "route":"/contest-detail",
      "action":"OPEN_CONTEST"
    }'
  # Expect: 200 with messageId
  ```

- [ ] **Rate Limiting** (send >10 requests/min, expect 429)
- [ ] **Stats Endpoint** (admin only, expect 403 for non-admin)
- [ ] **Cleanup Endpoint** (admin only)

---

## Phase 10: Error Handling Verification

- [ ] Missing auth token → 401
- [ ] Invalid deviceType → 400 with validation details
- [ ] Rate limited → 429 with retryAfter
- [ ] Invalid FCM credentials → 500 with helpful message
- [ ] Token not found → 404
- [ ] Invalid token (unregistered at FCM) → auto-invalidated, logged

---

## Phase 11: Production Hardening

- [ ] Secrets not in `.env` (git-ignored)
- [ ] Helmet security headers enabled
- [ ] CORS properly configured (not wildcard)
- [ ] Rate limiting thresholds tuned for your load
- [ ] Logging level set to `info` (not `debug`)
- [ ] Error responses don't leak sensitive info
- [ ] Full tokens never logged (log suffix only)
- [ ] HTTPS/TLS enforced in production
- [ ] Dependency versions pinned (no `^` or `~` wildcards)

**Verify:**
```bash
npm audit --production
# Should show 0 vulnerabilities
```

---

## Phase 12: Deployment

### Local/Development
```bash
npm run dev
```

### Staging/Production
```bash
npm run build
NODE_ENV=production node dist/server.js
```

### Docker
```bash
docker build -t photo-api:latest .
docker run -d -p 3000:3000 \
  -e NODE_ENV=production \
  -e FCM_SERVICE_ACCOUNT_B64="..." \
  -e MONGODB_URI="..." \
  photo-api:latest
```

### Kubernetes
```bash
kubectl create secret generic fcm-credentials \
  --from-literal=service-account-b64="..."
kubectl apply -f deployment.yaml
```

---

## Phase 13: Monitoring & Alerts

- [ ] Health check endpoint working
- [ ] Structured logging (JSON) in production
- [ ] Notifications delivery tracked
- [ ] Failed sends logged and analyzed
- [ ] Token cleanup job completion verified
- [ ] Rate limit metrics monitored
- [ ] Database connection pool health checked

**Sample Queries:**
```bash
# Check token registration rate
curl http://api.example.com/api/notifications/stats

# Manual cleanup if needed
curl -X POST http://api.example.com/api/notifications/cleanup \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

## Phase 14: Documentation & Handoff

- [ ] `/docs/TESTING.md` reviewed and tested
- [ ] `/docs/PRODUCTION_SETUP.md` followed
- [ ] Team trained on rate limiting behavior
- [ ] Runbook for token cleanup documented
- [ ] Escalation path for FCM auth failures defined
- [ ] Monitoring dashboard set up
- [ ] On-call runbook updated

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| `FCM initialization failed` | Check credentials in `.env`, verify Firebase Messaging API enabled |
| `Request validation failed` | Check request body matches schema (e.g., deviceType must be `android`, `ios`, or `web`) |
| `Rate limit exceeded` | Wait; adjust `RATE_LIMIT_*` env vars if needed |
| `No active tokens found` | Register token first via `/register-token` |
| `Stale tokens not cleaning` | Check cron schedule; manually trigger `/cleanup` |
| `Type errors in build` | Run `npm run type-check`, fix errors, rebuild |

---

## Sign-Off

Once all items checked:

- [ ] Local dev working end-to-end
- [ ] Tests passing (or manual testing complete)
- [ ] Type checks passing
- [ ] Production build created and tested
- [ ] Deployment tested in staging
- [ ] Monitoring and alerts configured
- [ ] Team trained
- [ ] Documentation reviewed

**Go-live ready!** 🚀

---

## Post-Launch

- Monitor for first 24 hours
- Check error logs for FCM auth issues
- Verify cleanup job runs daily
- Monitor token registration rate
- Collect initial stats for baseline

---

## Quick Reference

### Common Curl Commands

```bash
# Health check
curl http://localhost:3000/api/notifications/health

# Register token (requires JWT)
curl -X POST http://localhost:3000/api/notifications/register-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"token":"FCM_TOKEN","deviceType":"android","deviceName":"My Phone"}'

# Send to user
curl -X POST http://localhost:3000/api/notifications/send-to-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"userId":"USER_ID","title":"Hello","body":"World"}'

# Get stats (admin only)
curl http://localhost:3000/api/notifications/stats \
  -H "Authorization: Bearer $ADMIN_JWT"

# Trigger cleanup
curl -X POST http://localhost:3000/api/notifications/cleanup \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Environment Variables

```bash
# Credentials (choose one)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# OR
export FCM_SERVICE_ACCOUNT_B64=base64_encoded_json

# Database
export MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db

# Development
npm run dev

# Production build
npm run build
NODE_ENV=production node dist/server.js
```

---

## Support

- Check logs: `npm run dev`
- Validate schemas: See `utils/fcmValidation.ts`
- Error handling: See `utils/fcmErrors.ts`
- Configuration: See `.env.example`
