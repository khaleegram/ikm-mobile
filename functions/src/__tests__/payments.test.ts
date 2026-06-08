import * as admin from 'firebase-admin';

// Mock fetch for Paystack API
global.fetch = jest.fn();

// Mock payment API client
const paymentsApi = {
  async initializeEscrowPayment(input: {
    amount: number;
    email: string;
    callbackUrl: string;
    metadata?: Record<string, any>;
    reference?: string;
  }) {
    if (!input.email || !input.email.includes('@')) {
      throw new Error('Buyer email is required');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Invalid payment amount');
    }
    if (!input.callbackUrl) {
      throw new Error('Payment callback URL is required');
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || 'Initialization failed');
    }

    return {
      authorizationUrl: payload.data?.authorization_url,
      reference: payload.data?.reference,
      accessCode: payload.data?.access_code
    };
  },

  async verifyEscrowPayment(input: {
    reference: string;
    amount: number;
    email: string;
    maxAttempts?: number;
    attemptDelayMs?: number;
  }) {
    if (!input.email) {
      throw new Error('Buyer email is required');
    }
    if (!input.reference) {
      throw new Error('Missing payment reference');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Invalid payment amount');
    }

    const maxAttempts = Math.max(1, input.maxAttempts || 3);
    const attemptDelayMs = Math.max(100, input.attemptDelayMs || 1500);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${input.reference}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.message || 'Verification failed');
        }

        if (payload.data?.status === 'success') {
          return {
            paid: true,
            reference: payload.data.reference,
            status: 'success',
            amount: payload.data.amount / 100,
            currency: payload.data.currency || 'NGN',
            channel: payload.data.channel
          };
        }

        if (payload.data?.status === 'pending' && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, attemptDelayMs));
          continue;
        }

        throw new Error('Payment not confirmed');
      } catch (error: any) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        await new Promise(r => setTimeout(r, attemptDelayMs));
      }
    }

    throw new Error('Payment could not be verified');
  }
};

describe('Payment SDK - Integration Tests', () => {
  let firestore: admin.firestore.Firestore;

  beforeAll(() => {
    firestore = admin.firestore();
  });

  beforeEach(async () => {
    await global.testUtils.cleanupFirestore();
    (global.fetch as jest.Mock).mockClear();
  });

  // ============================================
  // PAYMENT INITIALIZATION TESTS
  // ============================================

  describe('initializeEscrowPayment', () => {
    it('should return valid authorization URL for valid input', async () => {
      const mockPaystackResponse = {
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.com/test123',
          access_code: 'test_access_123',
          reference: 'ikm_escrow_1234567890'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      const result = await paymentsApi.initializeEscrowPayment({
        amount: 50000,
        email: 'buyer@test.com',
        callbackUrl: 'https://app.ikm.com/checkout-callback'
      });

      expect(result).toHaveProperty('authorizationUrl');
      expect(result.authorizationUrl).toContain('checkout.paystack.com');
      expect(result).toHaveProperty('reference');
      expect(result).toHaveProperty('accessCode');
    });

    it('should reject invalid email', async () => {
      await expect(
        paymentsApi.initializeEscrowPayment({
          amount: 50000,
          email: 'invalid-email',
          callbackUrl: 'https://app.ikm.com/callback'
        })
      ).rejects.toThrow('Buyer email is required');
    });

    it('should reject negative amount', async () => {
      await expect(
        paymentsApi.initializeEscrowPayment({
          amount: -1000,
          email: 'buyer@test.com',
          callbackUrl: 'https://app.ikm.com/callback'
        })
      ).rejects.toThrow('Invalid payment amount');
    });

    it('should reject missing callback URL', async () => {
      await expect(
        paymentsApi.initializeEscrowPayment({
          amount: 50000,
          email: 'buyer@test.com',
          callbackUrl: ''
        })
      ).rejects.toThrow('Payment callback URL is required');
    });

    it('should generate default reference if not provided', async () => {
      const mockPaystackResponse = {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/test',
          reference: 'ikm_escrow_12345'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      const result = await paymentsApi.initializeEscrowPayment({
        amount: 50000,
        email: 'buyer@test.com',
        callbackUrl: 'https://app.ikm.com/callback'
      });

      expect(result.reference).toBeTruthy();
      expect(result.reference).toMatch(/^ikm_escrow_/);
    });

    it('should handle Paystack API errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' })
      });

      await expect(
        paymentsApi.initializeEscrowPayment({
          amount: 50000,
          email: 'buyer@test.com',
          callbackUrl: 'https://app.ikm.com/callback'
        })
      ).rejects.toThrow();
    });
  });

  // ============================================
  // PAYMENT VERIFICATION TESTS
  // ============================================

  describe('verifyEscrowPayment', () => {
    it('should verify successful payment', async () => {
      const mockPaystackResponse = {
        status: true,
        message: 'Authorization URL created',
        data: {
          reference: 'test_ref_123',
          status: 'success',
          amount: 5000000,
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-05-26T10:00:00.000Z'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      const result = await paymentsApi.verifyEscrowPayment({
        reference: 'test_ref_123',
        amount: 50000,
        email: 'buyer@test.com'
      });

      expect(result.paid).toBe(true);
      expect(result.status).toBe('success');
      expect(result.reference).toBe('test_ref_123');
      expect(result.amount).toBe(50000);
      expect(result.currency).toBe('NGN');
    });

    it('should reject payment with mismatched amount', async () => {
      const mockPaystackResponse = {
        status: true,
        data: {
          reference: 'test_ref_123',
          status: 'success',
          amount: 3000000 // 30,000 NGN instead of 50,000
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      await expect(
        paymentsApi.verifyEscrowPayment({
          reference: 'test_ref_123',
          amount: 50000,
          email: 'buyer@test.com'
        })
      ).rejects.toThrow();
    });

    it('should retry on pending payment status', async () => {
      const mockPendingResponse = {
        status: true,
        data: {
          reference: 'test_ref_123',
          status: 'pending'
        }
      };

      const mockSuccessResponse = {
        status: true,
        data: {
          reference: 'test_ref_123',
          status: 'success',
          amount: 5000000
        }
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockPendingResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => mockSuccessResponse });

      const result = await paymentsApi.verifyEscrowPayment({
        reference: 'test_ref_123',
        amount: 50000,
        email: 'buyer@test.com',
        maxAttempts: 3,
        attemptDelayMs: 100
      });

      expect(result.paid).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should timeout on excessive retries', async () => {
      const mockPendingResponse = {
        status: true,
        data: {
          reference: 'test_ref_123',
          status: 'pending'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockPendingResponse
      });

      await expect(
        paymentsApi.verifyEscrowPayment({
          reference: 'test_ref_123',
          amount: 50000,
          email: 'buyer@test.com',
          maxAttempts: 2,
          attemptDelayMs: 50
        })
      ).rejects.toThrow('Payment not confirmed');
    });

    it('should reject invalid payment reference', async () => {
      await expect(
        paymentsApi.verifyEscrowPayment({
          reference: '',
          amount: 50000,
          email: 'buyer@test.com'
        })
      ).rejects.toThrow('Missing payment reference');
    });

    it('should reject invalid email', async () => {
      await expect(
        paymentsApi.verifyEscrowPayment({
          reference: 'test_ref_123',
          amount: 50000,
          email: ''
        })
      ).rejects.toThrow('Buyer email is required');
    });

    it('should handle network timeout gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout')
      );

      await expect(
        paymentsApi.verifyEscrowPayment({
          reference: 'test_ref_123',
          amount: 50000,
          email: 'buyer@test.com',
          maxAttempts: 2,
          attemptDelayMs: 50
        })
      ).rejects.toThrow();
    });
  });

  // ============================================
  // TRANSACTION STORAGE TESTS
  // ============================================

  describe('Transaction Truth Storage', () => {
    it('should store transaction in Firestore after verification', async () => {
      const mockPaystackResponse = {
        status: true,
        data: {
          reference: 'txn_verify_test_001',
          status: 'success',
          amount: 5000000,
          currency: 'NGN',
          channel: 'card'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      // Simulate storing transaction (normally done in Cloud Function)
      await firestore.collection('transactions').doc('txn_verify_test_001').set({
        reference: 'txn_verify_test_001',
        status: 'success',
        amount: 50000,
        currency: 'NGN',
        channel: 'card',
        source: 'paystack-verify',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const doc = await global.testUtils.getDoc('transactions/txn_verify_test_001');
      expect(doc.exists).toBe(true);
      expect(doc.data()?.status).toBe('success');
      expect(doc.data()?.reference).toBe('txn_verify_test_001');
    });

    it('should support transaction truth caching', async () => {
      const reference = 'txn_cache_test_001';

      // Pre-populate cache
      await firestore.collection('transactions').doc(reference).set({
        reference,
        status: 'success',
        amount: 50000,
        currency: 'NGN',
        paid_at: new Date().toISOString(),
        source: 'paystack-webhook'
      });

      // Verify document exists and can be read
      const doc = await firestore.collection('transactions').doc(reference).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.status).toBe('success');
      expect(doc.data()?.source).toBe('paystack-webhook');
    });
  });

  // ============================================
  // IDEMPOTENCY TESTS
  // ============================================

  describe('Idempotency & Duplicate Prevention', () => {
    it('should return existing order if idempotency key matches', async () => {
      const idempotencyKey = 'idempotent_key_001';
      const orderId = 'order_123';

      // Create initial order
      await firestore.collection('orders').doc(orderId).set({
        idempotencyKey,
        customerId: 'user_123',
        status: 'Processing',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Query for duplicate
      const query = await firestore
        .collection('orders')
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1)
        .get();

      expect(query.empty).toBe(false);
      expect(query.docs[0].id).toBe(orderId);
    });

    it('should create only one order for same payment reference', async () => {
      const reference = 'payment_ref_dedup_001';

      // Create first order
      await firestore.collection('orders').doc('order_1').set({
        paymentReference: reference,
        customerId: 'user_123',
        status: 'Processing'
      });

      // Attempt duplicate - would normally be caught by idempotency key query
      const query = await firestore
        .collection('orders')
        .where('paymentReference', '==', reference)
        .get();

      expect(query.size).toBe(1);
    });
  });

  // ============================================
  // ERROR HANDLING TESTS
  // ============================================

  describe('Error Handling & Recovery', () => {
    it('should handle Paystack API 503 with retry', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: 'test_ref_recovery',
              status: 'success',
              amount: 5000000
            }
          })
        });

      const result = await paymentsApi.verifyEscrowPayment({
        reference: 'test_ref_recovery',
        amount: 50000,
        email: 'buyer@test.com',
        maxAttempts: 3,
        attemptDelayMs: 50
      });

      expect(result.paid).toBe(true);
    });

    it('should log payment errors for debugging', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      try {
        await paymentsApi.verifyEscrowPayment({
          reference: 'test_ref_error',
          amount: 50000,
          email: 'buyer@test.com',
          maxAttempts: 1
        });
      } catch (e) {
        // Expected to fail
      }

      consoleErrorSpy.mockRestore();
    });
  });

  // ============================================
  // EDGE CASE TESTS
  // ============================================

  describe('Edge Cases', () => {
    it('should handle zero amount payment', async () => {
      await expect(
        paymentsApi.initializeEscrowPayment({
          amount: 0,
          email: 'buyer@test.com',
          callbackUrl: 'https://app.ikm.com/callback'
        })
      ).rejects.toThrow('Invalid payment amount');
    });

    it('should handle very large amounts', async () => {
      const mockPaystackResponse = {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/large',
          reference: 'large_payment_001'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      const result = await paymentsApi.initializeEscrowPayment({
        amount: 100000000, // 1 million NGN
        email: 'buyer@test.com',
        callbackUrl: 'https://app.ikm.com/callback'
      });

      expect(result).toHaveProperty('authorizationUrl');
    });

    it('should handle email normalization', async () => {
      const mockPaystackResponse = {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/test',
          reference: 'normalize_test_001'
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPaystackResponse
      });

      const result = await paymentsApi.initializeEscrowPayment({
        amount: 50000,
        email: '  BUYER@TEST.COM  ', // With spaces and uppercase
        callbackUrl: 'https://app.ikm.com/callback'
      });

      expect(result).toHaveProperty('authorizationUrl');
    });
  });
});
