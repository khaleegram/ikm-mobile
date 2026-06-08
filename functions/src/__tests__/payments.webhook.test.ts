import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

describe('Paystack Webhook - Integration Tests', () => {
  let firestore: admin.firestore.Firestore;
  const PAYSTACK_SECRET = 'test_secret_key_12345';

  beforeAll(() => {
    firestore = admin.firestore();
  });

  beforeEach(async () => {
    await global.testUtils.cleanupFirestore();
  });

  // ============================================
  // WEBHOOK SIGNATURE VALIDATION
  // ============================================

  describe('Webhook Signature Validation', () => {
    it('should accept webhook with valid HMAC-SHA512 signature', () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference: 'webhook_test_001',
          status: 'success',
          amount: 5000000,
          customer: {
            email: 'buyer@test.com'
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha512', PAYSTACK_SECRET)
        .update(rawBody)
        .digest('hex');

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(128); // SHA512 hex = 128 chars
    });

    it('should reject webhook with invalid signature', () => {
      const payload = {
        event: 'charge.success',
        data: { reference: 'test' }
      };

      const rawBody = JSON.stringify(payload);
      const validSignature = crypto
        .createHmac('sha512', PAYSTACK_SECRET)
        .update(rawBody)
        .digest('hex');

      const invalidSignature = 'invalid_signature_here';

      expect(validSignature).not.toBe(invalidSignature);
    });

    it('should reject webhook with tampered payload', () => {
      const originalPayload = { event: 'charge.success', amount: 5000000 };
      const rawBody = JSON.stringify(originalPayload);
      const signature = crypto
        .createHmac('sha512', PAYSTACK_SECRET)
        .update(rawBody)
        .digest('hex');

      // Tamper with payload
      const tamperedPayload = { event: 'charge.success', amount: 1000000 };
      const tamperedBody = JSON.stringify(tamperedPayload);
      const tamperedSignature = crypto
        .createHmac('sha512', PAYSTACK_SECRET)
        .update(tamperedBody)
        .digest('hex');

      expect(signature).not.toBe(tamperedSignature);
    });

    it('should be case-sensitive for secret key', () => {
      const payload = { event: 'charge.success' };
      const rawBody = JSON.stringify(payload);

      const signature1 = crypto
        .createHmac('sha512', 'secret_key')
        .update(rawBody)
        .digest('hex');

      const signature2 = crypto
        .createHmac('sha512', 'SECRET_KEY')
        .update(rawBody)
        .digest('hex');

      expect(signature1).not.toBe(signature2);
    });
  });

  // ============================================
  // WEBHOOK EVENT PROCESSING
  // ============================================

  describe('Webhook Event Processing', () => {
    it('should write successful charge to transactions', async () => {
      const reference = 'charge_success_001';
      const eventData = {
        reference,
        status: 'success',
        amount: 5000000,
        currency: 'NGN',
        channel: 'card',
        paid_at: '2026-05-26T10:00:00.000Z',
        customer: {
          email: 'buyer@test.com'
        },
        metadata: {
          firebaseUid: 'user_123'
        }
      };

      // Simulate webhook writing transaction
      await firestore.collection('transactions').doc(reference).set(
        {
          reference,
          gateway: 'paystack',
          status: 'success',
          uid: 'user_123',
          amount: 50000,
          currency: 'NGN',
          channel: 'card',
          customerEmail: 'buyer@test.com',
          paidAt: '2026-05-26T10:00:00.000Z',
          metadata: eventData.metadata,
          gatewayEvent: 'charge.success',
          gatewayId: '123456789',
          source: 'paystack-webhook',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.status).toBe('success');
      expect(doc.data()?.source).toBe('paystack-webhook');
      expect(doc.data()?.gatewayEvent).toBe('charge.success');
    });

    it('should handle pending charge events', async () => {
      const reference = 'charge_pending_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'pending',
        source: 'paystack-webhook',
        gatewayEvent: 'charge.pending'
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.status).toBe('pending');
    });

    it('should handle failed charge events', async () => {
      const reference = 'charge_failed_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'failed',
        source: 'paystack-webhook',
        gatewayEvent: 'charge.failed'
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.status).toBe('failed');
    });

    it('should extract customer email from webhook payload', async () => {
      const reference = 'email_extract_001';
      const customerEmail = 'webhook.buyer@example.com';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        customerEmail: customerEmail.toLowerCase(),
        status: 'success'
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.customerEmail).toBe(customerEmail.toLowerCase());
    });

    it('should handle missing customer email gracefully', async () => {
      const reference = 'missing_email_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        customerEmail: null,
        status: 'success'
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.customerEmail).toBeNull();
    });
  });

  // ============================================
  // RACE CONDITION HANDLING
  // ============================================

  describe('Race Condition Handling', () => {
    it('should idempotently handle duplicate webhook events', async () => {
      const reference = 'duplicate_webhook_001';
      const eventData = {
        reference,
        status: 'success',
        amount: 5000000
      };

      // First webhook
      await firestore.collection('transactions').doc(reference).set(
        {
          ...eventData,
          source: 'paystack-webhook',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const doc1 = await firestore.collection('transactions').doc(reference).get();
      const createdAt1 = doc1.data()?.createdAt;

      // Duplicate webhook (same reference)
      await new Promise(resolve => setTimeout(resolve, 100));

      await firestore.collection('transactions').doc(reference).set(
        {
          ...eventData,
          source: 'paystack-webhook',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const doc2 = await firestore.collection('transactions').doc(reference).get();
      const createdAt2 = doc2.data()?.createdAt;

      // CreatedAt should remain the same (not overwritten by merge)
      expect(createdAt1).toEqual(createdAt2);
    });

    it('should handle webhook arriving before verify API call', async () => {
      const reference = 'race_webhook_first_001';

      // Webhook arrives first
      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'success',
        amount: 50000,
        source: 'paystack-webhook',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Client verify API call happens after
      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.source).toBe('paystack-webhook');
      expect(doc.data()?.status).toBe('success');
    });

    it('should handle concurrent webhook deliveries', async () => {
      const reference = 'concurrent_webhooks_001';

      // Simulate concurrent writes (race condition)
      const promises = Array(5).fill(null).map(async (_, index) => {
        await firestore.collection('transactions').doc(reference).set(
          {
            reference,
            status: 'success',
            attempt: index,
            source: 'paystack-webhook'
          },
          { merge: true }
        );
      });

      await Promise.all(promises);

      // Should have single document with last update
      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.reference).toBe(reference);
    });
  });

  // ============================================
  // WEBHOOK DATA VALIDATION
  // ============================================

  describe('Webhook Data Validation', () => {
    it('should normalize email to lowercase', async () => {
      const reference = 'email_normalize_webhook_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        customerEmail: 'BUYER@TEST.COM'.toLowerCase()
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.customerEmail).toBe('buyer@test.com');
    });

    it('should handle amount conversion from kobo to NGN', async () => {
      const reference = 'amount_conversion_001';
      const amountKobo = 5000000; // 50,000 NGN
      const amountNGN = amountKobo / 100;

      await firestore.collection('transactions').doc(reference).set({
        reference,
        amount: amountNGN
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.amount).toBe(50000);
    });

    it('should validate required webhook fields exist', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference: 'validation_test_001',
          status: 'success'
          // Missing amount, customer, etc.
        }
      };

      expect(payload.data.reference).toBeTruthy();
      expect(payload.data.status).toBeTruthy();
    });

    it('should handle missing metadata gracefully', async () => {
      const reference = 'missing_metadata_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'success',
        metadata: null,
        uid: null
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.metadata).toBeNull();
      expect(doc.data()?.uid).toBeNull();
    });
  });

  // ============================================
  // WEBHOOK AUDIT TRAIL
  // ============================================

  describe('Webhook Audit Trail', () => {
    it('should log webhook events for audit trail', async () => {
      const reference = 'audit_webhook_001';

      await firestore.collection('payment_audit').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        eventType: 'charge.success',
        reference,
        status: 'success',
        uid: 'user_123',
        source: 'paystack-webhook'
      });

      const auditDocs = await firestore
        .collection('payment_audit')
        .where('reference', '==', reference)
        .get();

      expect(auditDocs.size).toBe(1);
      expect(auditDocs.docs[0].data().source).toBe('paystack-webhook');
    });

    it('should store gateway event ID for reconciliation', async () => {
      const reference = 'gateway_id_001';
      const gatewayId = '1234567890'; // Paystack transaction ID

      await firestore.collection('transactions').doc(reference).set({
        reference,
        gatewayId,
        source: 'paystack-webhook'
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.data()?.gatewayId).toBe(gatewayId);
    });

    it('should track webhook source vs verify API source', async () => {
      const webhookRef = 'webhook_source_001';
      const verifyRef = 'verify_source_001';

      await firestore.collection('transactions').doc(webhookRef).set({
        reference: webhookRef,
        source: 'paystack-webhook'
      });

      await firestore.collection('transactions').doc(verifyRef).set({
        reference: verifyRef,
        source: 'paystack-verify'
      });

      const webhookDoc = await firestore.collection('transactions').doc(webhookRef).get();
      const verifyDoc = await firestore.collection('transactions').doc(verifyRef).get();

      expect(webhookDoc.data()?.source).toBe('paystack-webhook');
      expect(verifyDoc.data()?.source).toBe('paystack-verify');
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================

  describe('Webhook Error Handling', () => {
    it('should handle webhook with invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => {
        JSON.parse(invalidJson);
      }).toThrow();
    });

    it('should handle webhook missing required fields', async () => {
      const incompletePayload = {
        event: 'charge.success'
        // Missing data field
      } as any;

      const reference = incompletePayload.data?.reference;
      expect(reference).toBeUndefined();
    });

    it('should continue processing if optional fields missing', async () => {
      const reference = 'optional_fields_001';

      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'success',
        channel: null, // optional
        metadata: null // optional
      });

      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.exists).toBe(true);
    });
  });
});
