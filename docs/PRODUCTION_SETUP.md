# FCM Notifications - Production Setup & Deployment

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Credential Setup](#credential-setup)
3. [Environment Configuration](#environment-configuration)
4. [Database Migration](#database-migration)
5. [Type Checking & Build](#type-checking--build)
6. [Deployment](#deployment)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js**: 18.0.0 or higher
- **MongoDB**: 4.4+ (Atlas or self-hosted)
- **Firebase Project**: With Cloud Messaging enabled
- **Docker** (optional, for containerized deployment)
- **npm**: 10.0.0 or higher

Verify installation:
```bash
node --version   # v18.0.0+
npm --version    # 10.0.0+
```

---

## Credential Setup

### Option A: File-Based Credentials (Development)

1. Download service account JSON from Firebase Console:
   - Firebase Console → Project Settings → Service Accounts
   - Click "Generate Private Key"
   - Save as `service-account.json`

2. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/service-account.json
   ```

### Option B: Base64 Encoding (Docker/Kubernetes)

1. Encode service account JSON:
   ```bash
   base64 -i service-account.json -o service-account.b64
   ```

   Or single line (for .env):
   ```bash
   FCM_SERVICE_ACCOUNT_B64=$(cat service-account.json | base64 | tr -d '\n')
   ```

2. Add to `.env`:
   ```bash
   FCM_SERVICE_ACCOUNT_B64=eyJwcm9qZWN0X2lkIjoieHl6IiwgInR5cGUiOiAi...
   ```

3. Service initializes automatically on startup

**Security Note:** Never commit `service-account.json` or base64 encoded credentials to version control.

---

## Environment Configuration

### Create Production `.env`

Copy and configure `.env.example`:

```bash
cp .env.example .env
```

**Key Variables:**

```bash
# Node Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Firebase Credentials (use ONE option)
# Option A: File path
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Option B: Base64 encoded
# FCM_SERVICE_ACCOUNT_B64=<base64-encoded-json>

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/photocurator
MONGODB_POOL_SIZE=20
MONGODB_TIMEOUT=30000

# FCM Service
FCM_TOKEN_CACHE_TTL_MS=3600000
FCM_REQUEST_TIMEOUT_MS=10000
FCM_BATCH_SIZE=100
FCM_MAX_RETRIES=3

# Rate Limiting (per minute)
RATE_LIMIT_SEND_WINDOW_MS=60000
RATE_LIMIT_SEND_MAX_REQUESTS=10
RATE_LIMIT_REGISTER_WINDOW_MS=900000
RATE_LIMIT_REGISTER_MAX_REQUESTS=50

# Scheduled Cleanup
FCM_CLEANUP_CRON_SCHEDULE=0 2 * * *        # Daily at 2 AM UTC
FCM_TOKEN_STALE_DAYS=90                     # Delete tokens not used in 90 days

# CORS
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Logging (Optional: Sentry)
# SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

---

## Database Migration

### 1. Ensure MongoDB Connection

Test connection:
```bash
mongosh "mongodb+srv://user:pass@cluster.mongodb.net/photocurator"
```

### 2. Create Indexes

Indexes are created automatically by Mongoose schema definition, but you can verify:

```bash
# Via MongoDB CLI
db.devicetokens.getIndexes()
```

**Expected Indexes:**
- `userId` (ascending)
- `token` (unique)
- `isActive`
- `createdAt`
- `lastUsedAt`
- `invalidatedAt` (TTL, expires after 90 days)
- Compound: `userId + isActive`
- Compound: `token + isActive`
- Compound: `isActive + lastUsedAt`

---

## Type Checking & Build

### 1. Type Check (No Compilation)

Validate TypeScript without output:
```bash
npm run type-check
```

### 2. Build for Production

Compile TypeScript to JavaScript:
```bash
npm run build
```

Output: JavaScript files in `dist/` directory

### 3. Verify Build

```bash
# Check dist directory exists
ls -la dist/

# Test with Node
node dist/server.js --version
```

---

## Deployment

### Option A: Direct Server Deployment

1. **Build:**
   ```bash
   npm run build
   ```

2. **Start:**
   ```bash
   node dist/server.js
   ```

3. **With Process Manager (PM2):**
   ```bash
   npm install -g pm2
   pm2 start dist/server.js --name "photo-api"
   pm2 save
   ```

### Option B: Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy files
COPY package*.json ./
COPY . .

# Build
RUN npm ci --only=production
RUN npm run build

# Set production mode
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start
CMD ["node", "dist/server.js"]
```

**Build & Run:**
```bash
docker build -t photo-api:latest .

docker run -d \
  --name photo-api \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e FCM_SERVICE_ACCOUNT_B64="$(cat service-account.json | base64)" \
  -e MONGODB_URI="mongodb+srv://..." \
  photo-api:latest
```

### Option C: Kubernetes Deployment

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: photo-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: photo-api
  template:
    metadata:
      labels:
        app: photo-api
    spec:
      containers:
      - name: photo-api
        image: photo-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: FCM_SERVICE_ACCOUNT_B64
          valueFrom:
            secretKeyRef:
              name: fcm-credentials
              key: service-account-b64
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: mongodb-uri
        livenessProbe:
          httpGet:
            path: /api/notifications/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/notifications/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

**Create Secret:**
```bash
kubectl create secret generic fcm-credentials \
  --from-literal=service-account-b64="$(cat service-account.json | base64)"

kubectl create secret generic db-credentials \
  --from-literal=mongodb-uri="mongodb+srv://..."

kubectl apply -f deployment.yaml
```

---

## Monitoring

### 1. Health Check Endpoint

```bash
curl -X GET http://api.example.com/api/notifications/health
```

Expected response:
```json
{
  "success": true,
  "message": "FCM notification service is healthy",
  "timestamp": "2025-06-13T10:30:00.000Z"
}
```

### 2. Logs

**Development:**
```bash
npm run dev
```

**Production (Pino logs):**
```bash
tail -f logs/app.log | pino-pretty
```

**JSON logs for aggregation:**
```json
{
  "level": 30,
  "time": 1623585000000,
  "pid": 12345,
  "hostname": "prod-server",
  "msg": "Notification sent to user",
  "userId": "66abc1234def567890123456",
  "sent": 2,
  "failed": 0
}
```

### 3. Metrics to Monitor

- **Token Registration Rate**: Should be 50-200/hour during active hours
- **Notification Send Success Rate**: Target >98%
- **FCM API Response Time**: Should be <500ms
- **Database Connection Pool**: Monitor connection usage
- **Invalid Token Cleanup**: Should remove 50-200 tokens daily
- **Rate Limit Hits**: Indicates potential abuse

### 4. Alerting

Set up alerts for:
- FCM auth failures
- Database connection errors
- High error rates (>2%)
- Response time >1000ms
- Notification send failures

---

## Troubleshooting

### Issue: "FCM initialization failed"

**Cause:** Invalid or missing credentials

**Solution:**
1. Verify `.env` has credentials
2. Test base64 encoding:
   ```bash
   echo $FCM_SERVICE_ACCOUNT_B64 | base64 -d | jq .
   ```
3. Check Firebase project has Messaging API enabled

### Issue: "No active tokens found for user"

**Expected behavior** - user hasn't registered a device yet

**Solution:** Client must call `/api/notifications/register-token` first

### Issue: "Rate limit exceeded"

**Expected behavior** - too many requests

**Solution:** Implement backoff; check `retryAfter` header

### Issue: Type errors in build

**Solution:**
```bash
npm run type-check
# Fix errors
npm run build
```

### Issue: Stale tokens not being cleaned

**Solution:**
1. Verify cleanup job is running:
   ```bash
   # Check logs for "FCM token cleanup job"
   ```
2. Manually trigger:
   ```bash
   curl -X POST http://api.example.com/api/notifications/cleanup \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```
3. Check `FCM_CLEANUP_CRON_SCHEDULE` is set correctly

### Issue: Tokens being invalidated as UNREGISTERED

**Cause:** Device uninstalled app or disabled notifications

**Behavior:** Token automatically invalidated and removed after 90 days

**Normal operation** - no action needed

---

## Performance Tuning

### Connection Pooling

```env
MONGODB_POOL_SIZE=20          # Increase for high-load
MONGODB_TIMEOUT=30000          # Increase if timeouts occur
```

### Rate Limiting

Adjust for your load:
```env
RATE_LIMIT_SEND_MAX_REQUESTS=20      # From 10, for higher load
RATE_LIMIT_SEND_WINDOW_MS=120000      # From 60s, to 2 min
```

### Batch Processing

```env
FCM_BATCH_SIZE=500            # From 100, for larger batches
```

### Cache TTL

```env
FCM_TOKEN_CACHE_TTL_MS=1800000  # From 3600s, reduce cache time
```

---

## Security Checklist

- [ ] `.env` file is `.gitignore`d
- [ ] Base64 credentials not hardcoded
- [ ] CORS origins whitelisted
- [ ] Rate limiting enabled
- [ ] Authentication required on all endpoints except `/health`
- [ ] Admin checks on `/stats` and `/cleanup`
- [ ] HTTPS enabled in production
- [ ] Tokens never logged in full
- [ ] Regular dependency updates: `npm audit`
- [ ] Helmet security headers enabled

---

## Support & Documentation

- [Firebase Cloud Messaging Docs](https://firebase.google.com/docs/cloud-messaging)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Pino Logging](https://getpino.io/)
- [Rate Limiting Guide](https://github.com/nfriedly/express-rate-limit)
