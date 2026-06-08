# Payment SDK - Production Deployment Guide

**Version:** 1.0  
**Last Updated:** 2026-05-26  
**Status:** Production Ready (95% maturity)

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Configuration](#environment-configuration)
3. [Database & Security Deployment](#database--security-deployment)
4. [Cloud Functions Deployment](#cloud-functions-deployment)
5. [Monitoring & Alerting Setup](#monitoring--alerting-setup)
6. [Testing in Staging](#testing-in-staging)
7. [Production Rollout Plan](#production-rollout-plan)
8. [Runbooks & Incident Response](#runbooks--incident-response)
9. [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment Checklist

### Code Quality
- [ ] All 35+ payment tests pass locally
- [ ] Test coverage ≥ 85% for payment modules
- [ ] TypeScript build completes without errors
- [ ] ESLint passes without warnings
- [ ] No console.log statements (use structured logger)

### Security
- [ ] Paystack secret key set in Firebase Secrets Manager
- [ ] CORS origins restricted (not `origin: true`)
- [ ] Rate limiting configured per endpoint
- [ ] Firestore security rules reviewed and deployed
- [ ] Payment audit trail collection rules enforced
- [ ] No secrets in code, environment variables, or git history

### Performance
- [ ] Circuit breaker thresholds tuned
- [ ] Retry logic configured (1.5s delays, max 3 attempts)
- [ ] Timeout set to 10 seconds for external API calls
- [ ] Firestore connection pooling verified

### Documentation
- [ ] README.md updated with new endpoints
- [ ] API documentation includes `getTransactionTruth`
- [ ] Runbooks created for payment incidents
- [ ] Change log documented

---

## Environment Configuration

### 1. Firebase Secrets Manager

Set up Paystack API key as Firebase Secret:

```bash
# In Firebase project directory
firebase functions:secrets:set PAYSTACK_SECRET_KEY

# Verify secret is set
firebase functions:secrets:list

# Output should show:
# PAYSTACK_SECRET_KEY (available to: functions)
```

### 2. Environment Variables

Create `.env.production` for Cloud Functions:

```env
# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_live_xxxxxxxxxx  # Set via Firebase Secrets, not here
PAYSTACK_TIMEOUT_MS=10000
PAYSTACK_WEBHOOK_URL=https://paystackwebhook-[REGION].cloudfunctions.net

# App Configuration
ALLOWED_ORIGINS=https://ikm.app,https://www.ikm.app,https://seller.ikm.app
ENVIRONMENT=production
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_VERIFY_MAX=5          # Max 5 verify calls per user per minute
RATE_LIMIT_INIT_MAX=10           # Max 10 init calls per user per minute
RATE_LIMIT_WINDOW_MS=60000       # 1 minute window

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
```

### 3. Firebase Project Configuration

Update `firebase.json`:

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "coverage",
        "*.test.ts"
      ],
      "runtime": "nodejs20"
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "pubsub": { "port": 8085 }
  }
}
```

---

## Database & Security Deployment

### 1. Deploy Firestore Security Rules

```bash
# Validate rules
firebase rules:test firestore

# Deploy rules
firebase deploy --only firestore:rules

# Verify in Firebase Console: Firestore > Rules
```

### 2. Create Firestore Indexes

For payment queries to perform well, create these indexes:

**Index 1: transactions collection (for webhook deduplication)**
```
Collection: transactions
Fields: status (Ascending), createdAt (Descending)
```

**Index 2: payment_audit collection (for admin reporting)**
```
Collection: payment_audit
Fields: eventType (Ascending), timestamp (Descending)
```

Deploy via Firebase Console or:

```bash
firebase deploy --only firestore:indexes
```

### 3. Verify Collections Exist

Collections are created on first write. To pre-create and configure:

```bash
firebase firestore:start
# In another terminal:
firebase emulators:exec 'node scripts/init-firestore.js'
```

---

## Cloud Functions Deployment

### 1. Build & Test

```bash
cd functions

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (requires Firestore emulator)
npm test

# Check coverage
npm run test:coverage
```

### 2. Deploy Functions

**Stage 1: Deploy payment functions only**

```bash
firebase deploy --only functions:initializePaystackTransaction,functions:verifyPaystackTransaction,functions:getTransactionTruth

# Wait for deployment to complete
firebase functions:log --limit 50
```

**Stage 2: Deploy supporting functions**

```bash
firebase deploy --only functions:paystackWebhook,functions:verifyPaymentAndCreateOrder,functions:findRecentTransactionByEmail

firebase functions:log --limit 50
```

**Stage 3: Deploy payout functions**

```bash
firebase deploy --only functions:savePayoutDetails,functions:requestPayout,functions:cancelPayoutRequest,functions:getBanksList,functions:resolveAccountNumber,functions:getAllPayouts

firebase functions:log --limit 50
```

### 3. Verify Deployments

```bash
# List deployed functions
firebase functions:list

# Test a function
curl -X POST "https://initializepaystacktransaction-[REGION].cloudfunctions.net" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50000, "email": "test@example.com", "callbackUrl": "https://app.ikm.com/callback"}'
```

---

## Monitoring & Alerting Setup

### 1. Cloud Logging Queries

Save these queries in **Cloud Logging Console** for monitoring:

**Query 1: Payment Initialization Failures**
```
resource.type="cloud_function"
resource.labels.function_name="initializePaystackTransaction"
severity="ERROR"
```

**Query 2: Payment Verification Latency**
```
resource.type="cloud_function"
resource.labels.function_name="verifyPaystackTransaction"
jsonPayload.duration >= 5000
```

**Query 3: Webhook Signature Failures**
```
resource.type="cloud_function"
resource.labels.function_name="paystackWebhook"
jsonPayload.error=~"signature|signature"
```

**Query 4: Rate Limit Violations**
```
resource.type="cloud_function"
jsonPayload.error=~"Rate limit exceeded"
```

### 2. Create Alerts

In **Cloud Monitoring Console**:

**Alert 1: Payment Verification Failures (>5% of requests)**
- Metric: `cloudfunctions.googleapis.com/execution_times`
- Filter: `function_name="verifyPaystackTransaction" AND status="error"`
- Threshold: Error rate > 5% for 5 minutes
- Notification: Slack, Email, PagerDuty

**Alert 2: Circuit Breaker Open**
- Metric: Custom metric (when circuit opens)
- Threshold: Circuit state == "OPEN"
- Notification: Immediate alert

**Alert 3: Webhook Processing Latency**
- Metric: `cloudfunctions.googleapis.com/execution_times`
- Filter: `function_name="paystackWebhook"`
- Threshold: p99 latency > 2000ms for 5 minutes

**Alert 4: Firestore Rate Limit**
- Metric: `firestore.googleapis.com/quota/metrics`
- Threshold: Usage > 80% of quota

### 3. Create Dashboard

Create custom dashboard in **Cloud Monitoring** showing:

```
Row 1: Payment Metrics
  - Payment Initializations (last 24h)
  - Verification Success Rate
  - Webhook Events Received

Row 2: Performance
  - Verification Latency (p50, p95, p99)
  - Webhook Processing Time
  - Circuit Breaker State

Row 3: Errors
  - Error Rate by Function
  - Failed Transactions (last 24h)
  - Rate Limit Violations
```

---

## Testing in Staging

### 1. Staging Environment Setup

```bash
# Create staging Firebase project
gcloud projects create ikm-payment-staging
gcloud config set project ikm-payment-staging

# Deploy to staging
firebase deploy --project ikm-payment-staging
```

### 2. Staging Test Plan

**Phase 1: Happy Path Tests (Day 1)**
- [ ] Initialize payment: 100 requests ✓
- [ ] Verify payment: 100 successful transactions ✓
- [ ] Webhook: Send 50 test webhooks, verify Firestore writes ✓
- [ ] Order creation: Complete 50 end-to-end orders ✓

**Phase 2: Load Testing (Day 2)**
- [ ] Concurrent payment verifications: 50 concurrent requests
- [ ] Webhook burst: 100 webhooks in 10 seconds
- [ ] Database: Verify transaction truth reads work at 95% hit rate
- [ ] Circuit breaker: Verify it opens after 5 failures

**Phase 3: Error Scenarios (Day 3)**
- [ ] Paystack API timeout (simulate with delay)
- [ ] Duplicate webhook events
- [ ] Payment amount mismatch
- [ ] Invalid tokens, auth failures
- [ ] Rate limiting triggers

**Phase 4: Monitoring Validation (Day 4)**
- [ ] All log events appear in Cloud Logging
- [ ] Dashboard metrics populate correctly
- [ ] Alerts trigger on test errors
- [ ] Dashboards refresh correctly

### 3. Staging Smoke Tests

```bash
# Run integration tests against staging
FIREBASE_PROJECT=ikm-payment-staging npm run test:integration

# Check logs
firebase functions:log --project ikm-payment-staging --limit 100
```

---

## Production Rollout Plan

### Week 1: Infrastructure Validation

**Day 1-2: Pre-deployment checks**
- [ ] All tests pass
- [ ] Security rules validated
- [ ] Monitoring dashboards ready
- [ ] Incident runbooks prepared
- [ ] Team trained on monitoring

**Day 3-4: Staging complete**
- [ ] 48 hours of stable staging testing
- [ ] Load test results analyzed
- [ ] No critical issues found
- [ ] Sign-off from engineering & ops

**Day 5: Production deployment**
- [ ] Schedule deployment for low-traffic window (2am UTC)
- [ ] Have 2 on-call engineers ready
- [ ] Document baseline metrics before deployment

### Week 1 Evening: Canary Rollout

**Phase 1: 5% traffic (2am UTC)**
```bash
firebase deploy --only functions
# Monitor for 15 minutes
# Check: no errors, response times normal, payment success rate
```

**Phase 2: 25% traffic (if Phase 1 good)**
```bash
# Route 25% of traffic to new version
# Monitor for 30 minutes
# Check: error budgets OK, no regressions
```

**Phase 3: 50% traffic (if Phase 2 good)**
```bash
# Route 50% of traffic
# Monitor for 1 hour
```

**Phase 4: 100% traffic (if Phase 3 good)**
```bash
# Full rollout
# Monitor for 4 hours
```

### Week 1 Complete: Stability Period

- [ ] 7+ days of stable production
- [ ] Payment success rate ≥ 99.5%
- [ ] Error rate ≤ 0.1%
- [ ] No incidents
- [ ] Monitoring data confirms correct behavior

---

## Runbooks & Incident Response

### Payment Verification Stuck

**Symptom:** Payments verified in Paystack but not confirming in app

**Immediate Actions:**
1. Check Cloud Logs: `function_name="verifyPaystackTransaction" AND severity="ERROR"`
2. Check Firestore `transactions` collection for stuck documents
3. Check circuit breaker state: is it open?

**If Circuit Open:**
```bash
# Restart circuit breaker (wait 1 min or manually reset in function)
# Monitor for recovery
firebase functions:log --limit 50
```

**If Transaction Missing:**
```bash
# Manually trigger webhook for missing references
curl -X POST "https://paystackwebhook-[REGION].cloudfunctions.net" \
  -H "x-paystack-signature: [signature]" \
  -d '{"event":"charge.success","data":{...}}'
```

### High Error Rate

**Symptom:** Payment initialization or verification errors > 1%

**Immediate Actions:**
1. Check Paystack status page: https://status.paystack.com
2. Check Cloud Functions error logs
3. Check Firestore quota usage

**If Paystack Down:**
```bash
# Circuit breaker will auto-open
# Client gets graceful error: "Payment service temporarily unavailable"
# Wait for Paystack recovery (~30 min typical)
```

**If Firestore Quota Exceeded:**
```bash
# Disable audit trail logging temporarily
# Scale down non-critical jobs
# Contact Firebase support for quota increase
```

### Webhook Delivery Issues

**Symptom:** Transactions not written via webhook, only via client verify

**Immediate Actions:**
1. Check webhook signature validation logs
2. Verify webhook URL in Paystack dashboard
3. Check Firestore write logs

**Fix:**
```bash
# Re-enable webhook in Paystack dashboard
# Test with sample webhook
# Backfill missing transactions via Paystack API
```

---

## Rollback Procedures

### If Critical Issue Found

**Step 1: Immediate Mitigation**
```bash
# Option A: Revert to previous function version
firebase deploy --only functions --version [previous-sha]

# Option B: Disable problematic function
# (Remove from index.ts, redeploy)
```

**Step 2: Communication**
- [ ] Alert team on Slack #incidents
- [ ] Notify customers if needed
- [ ] Create incident post-mortem ticket

**Step 3: Root Cause Analysis**
- [ ] Identify what failed
- [ ] Check logs from before deployment
- [ ] Review changes in this deployment

**Step 4: Fix & Redeploy**
- [ ] Fix the issue in code
- [ ] Rebuild and retest
- [ ] Deploy with more monitoring

### If Firestore Rules Issue

```bash
# Revert to previous rules version
git checkout HEAD~1 firestore.rules
firebase deploy --only firestore:rules

# Check if write operations resume
firebase firestore:list
```

---

## Post-Deployment Checklist

- [ ] All functions deployed successfully
- [ ] Test payment: init → verify → order creation works end-to-end
- [ ] Webhook: test with Paystack test mode
- [ ] Monitoring: all dashboards show data
- [ ] Alerts: test alert channels
- [ ] Customer notifications: no new payment issues reported
- [ ] Performance: latency within SLAs
- [ ] Security: rate limiting working, no unauthorized access

---

## Success Metrics (SLOs)

After deployment, these SLOs should be met:

| Metric | Target | Threshold |
|--------|--------|-----------|
| Payment success rate | ≥99.5% | Alert if <99% for 5min |
| Verification latency (p99) | <500ms | Alert if >1000ms for 10min |
| Webhook processing latency | <1000ms | Alert if >2000ms for 5min |
| Error rate | ≤0.1% | Alert if >0.5% for 5min |
| Uptime | ≥99.99% | Max 4 min downtime/month |

---

## Support & Escalation

**Payment SDK on-call rotation:** [Link to schedule]

**Escalation Chain:**
1. **L1 (15 min response):** Payment SDK engineer on-call
2. **L2 (30 min response):** Backend team lead
3. **L3 (1 hour response):** Engineering manager

**Contact Channels:**
- Slack: #payment-sdk-incidents
- PagerDuty: Payment SDK service
- Email: payment-team@ikm.io

---

## Appendix: Quick Commands

```bash
# View live logs
firebase functions:log --limit 100 --follow

# View specific function logs
firebase functions:log verifyPaystackTransaction --limit 50

# Restart a function (does not affect deployed version)
firebase functions:delete verifyPaystackTransaction --force

# Check function memory/timeout
firebase deploy --only functions --dry-run

# View Firestore data (production)
firebase firestore:export ./backups/backup-$(date +%s)

# Query Cloud Logging
gcloud logging read "resource.type=cloud_function AND severity=ERROR" --limit 50

# Create alert policy
gcloud alpha monitoring policies create --notification-channels=[ID] [policy.json]
```

---

**Last Updated:** 2026-05-26  
**Next Review:** 2026-06-30  
**Owner:** Payment SDK Team
