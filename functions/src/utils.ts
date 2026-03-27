/**
 * Utility functions for Cloud Functions
 */

import { Response } from 'express';
import * as admin from 'firebase-admin';

/**
 * Verify Firebase ID token from Authorization header
 * Returns decoded token or throws error
 */
export async function verifyIdToken(authHeader: string | null): Promise<{
  uid: string;
  email?: string;
  isAdmin?: boolean;
}> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing or invalid Authorization header');
  }

  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      isAdmin: decodedToken.isAdmin === true,
    };
  } catch (error) {
    throw new Error('Unauthorized: Invalid or expired token');
  }
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(authHeader: string | null) {
  return verifyIdToken(authHeader);
}

/**
 * Require admin - throws if not admin
 */
export async function requireAdmin(authHeader: string | null) {
  const auth = await verifyIdToken(authHeader);
  if (!auth.isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }
  return auth;
}

/**
 * Get platform commission rate (with caching)
 */
let cachedCommissionRate: number | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getPlatformCommissionRate(): Promise<number> {
  if (cachedCommissionRate !== null && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedCommissionRate;
  }

  const firestore = admin.firestore();
  const settingsDoc = await firestore.collection('platform_settings').doc('platform_settings').get();
  
  if (settingsDoc.exists) {
    const data = settingsDoc.data();
    cachedCommissionRate = (data?.platformCommissionRate as number) || 0.05;
  } else {
    cachedCommissionRate = 0.05; // Default 5%
  }
  
  cacheTimestamp = Date.now();
  return cachedCommissionRate; // This will always be a number at this point
}

/**
 * Get Paystack secret key
 * 
 * @param secretValue - Optional secret value from Firebase Secrets (preferred method)
 * @returns Paystack secret key
 */
export function getPaystackSecretKey(secretValue?: string): string {
  // Use provided secret value (from Firebase Secrets - preferred method)
  if (secretValue) {
    return secretValue;
  }
  
  // Fallback to environment variable
  if (process.env.PAYSTACK_SECRET_KEY) {
    return process.env.PAYSTACK_SECRET_KEY;
  }
  
  // Fallback to legacy config (for backward compatibility)
  try {
    const functions = require('firebase-functions');
    const config = functions.config();
    const paystackKey = config?.paystack?.secret_key;
    if (paystackKey) {
      return paystackKey;
    }
  } catch (error: any) {
    console.error('Error accessing functions config:', error?.message || error);
  }
  
  // If nothing found, throw error
  throw new Error(
    'Paystack secret key is not configured.\n' +
    'Set it using Firebase Secrets:\n' +
    '1. firebase functions:secrets:set PAYSTACK_SECRET_KEY\n' +
    '2. Redeploy functions: firebase deploy --only functions'
  );
}

/**
 * Helper to send JSON response
 */
export function sendResponse(response: Response, data: any, statusCode: number = 200) {
  response.status(statusCode).json(data);
}

/**
 * Helper to send error response
 */
export function sendError(response: Response, error: string, statusCode: number = 400) {
  response.status(statusCode).json({
    success: false,
    error,
  });
}

