import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import cors = require('cors');
import {
    requireAuth,
    sendError,
    sendResponse,
} from './utils';

const corsHandler = cors({ origin: true });

/**
 * Create support ticket
 */
export const createSupportTicket = onRequest(async (request, response) => {
  return corsHandler(request, response, async () => {
    try {
      if (request.method !== 'POST') return sendError(response, 'Method not allowed', 405);
      const auth = await requireAuth(request.headers.authorization || null);
      const { subject, message, priority, category } = request.body;
      
      if (!subject || !message) return sendError(response, 'Subject and message are required');

      const ref = await admin.firestore().collection('support_tickets').add({
        userId: auth.uid,
        subject,
        message,
        priority: priority || 'normal',
        category: category || 'general',
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return sendResponse(response, { success: true, ticketId: ref.id });
    } catch (error: any) {
      return sendError(response, error.message, 500);
    }
  });
});

/**
 * Get user support tickets
 */
export const getUserSupportTickets = onRequest(async (request, response) => {
    return corsHandler(request, response, async () => {
      const auth = await requireAuth(request.headers.authorization || null);
      const snapshot = await admin.firestore().collection('support_tickets').where('userId', '==', auth.uid).orderBy('createdAt', 'desc').get();
      return sendResponse(response, { success: true, tickets: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    });
});
