import { auth, firestore } from '@/lib/firebase/config';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

/** Temporary Firestore report sink until admin reports move to chatcart-api. */
export async function marketSocialApiLegacyReport(input: {
  targetType: 'post' | 'sound' | 'user';
  targetId: string;
  reason: string;
  details?: string;
}) {
  const reporterId = auth.currentUser?.uid;
  if (!reporterId) throw new Error('Please log in to continue.');
  const targetId = String(input.targetId || '').trim();
  const reason = String(input.reason || '').trim().slice(0, 80);
  const details = String(input.details || '').trim().slice(0, 600);
  if (!targetId) throw new Error('Nothing to report.');
  if (!reason) throw new Error('Please select a reason.');

  const reportRef = doc(collection(firestore, 'marketReports'));
  await setDoc(reportRef, {
    reporterId,
    targetType: input.targetType,
    targetId,
    reason,
    details: details || null,
    createdAt: serverTimestamp(),
  });
}
