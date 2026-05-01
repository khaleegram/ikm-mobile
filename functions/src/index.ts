/**
 * IKM Marketplace - Cloud Functions Entry Point
 * Modularized for better scalability and maintenance.
 */

import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp();

// Export modules
export * from './admin';
export * from './dashboard';
// Follow counts: updated client-side in batch with `marketFollows` (+ Firestore rules).
// Do not re-enable ./market-social triggers here — they would double-increment counts.
export * from './market';
export * from './orders';
export * from './payments';
export * from './products';
export * from './reports';
export * from './settings';
export * from './support';
export * from './users';

// Legacy / Testing
import * as functions from 'firebase-functions';
export const helloWorld = functions.https.onRequest((request, response) => {
  response.json({ message: 'Hello from Modular IKM Backend! 🎉' });
});
