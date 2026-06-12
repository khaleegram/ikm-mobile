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
export * from './feed-algorithm';
// Follow counts are updated client-side in batch with marketFollows and Firestore rules.
// Do not re-enable ./market-social triggers here; they would double-increment counts.
export * from './market';
export * from './notifications';
export * from './order-chat';
export * from './orders';
export * from './payments';
export * from './products';
export * from './reports';
export * from './reviews';
export * from './settings';
export * from './support';
export * from './users';
