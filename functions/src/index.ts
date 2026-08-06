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
// feed-algorithm + market CF modules retired — market feed/posts/likes/comments/chat
// live on chatcart-api (Neon). Do not re-export them; deployed leftovers should be
// deleted on the next functions deploy (`firebase functions:delete …`).
// Follow counts: do not re-enable ./market-social triggers (double-increment risk).
export * from './notifications';
export * from './order-chat';
export * from './orders';
export * from './payments';
export * from './products';
export * from './refunds';
export * from './reports';
export * from './reviews';
export * from './settings';
export * from './support';
export * from './users';
