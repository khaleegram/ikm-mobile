import * as admin from 'firebase-admin';

// Prevent Firebase from initializing multiple times
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: 'test-project',
  });
}

// Firestore emulator configuration
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';

// Global test helpers
global.testUtils = {
  async cleanupFirestore() {
    const firestore = admin.firestore();
    const collections = [
      'transactions',
      'payment_sessions',
      'payment_verifications',
      'payment_audit',
      'orders',
      'users',
      'products'
    ];

    for (const collection of collections) {
      const docs = await firestore.collection(collection).get();
      for (const doc of docs.docs) {
        await doc.ref.delete();
      }
    }
  },

  async getDoc(path: string) {
    return admin.firestore().doc(path).get();
  },

  async setDoc(path: string, data: any) {
    return admin.firestore().doc(path).set(data, { merge: true });
  }
};

// Jest global setup
afterAll(async () => {
  if (admin.app()) {
    await admin.app().delete();
  }
});

// Suppress console output during tests
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
});

declare global {
  // eslint-disable-next-line no-var
  var testUtils: {
    cleanupFirestore(): Promise<void>;
    getDoc(path: string): Promise<any>;
    setDoc(path: string, data: any): Promise<any>;
  };
}
