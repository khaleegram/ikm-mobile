// Client-side hooks for reading email campaigns (read-only)
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, Unsubscribe, orderBy, limit } from 'firebase/firestore';
import { firestore } from '../config';
import { EmailCampaign } from '@/types';

export function useSellerEmailCampaigns(sellerId: string | null) {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setCampaigns([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'email_campaigns'),
      where('sellerId', '==', sellerId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const campaignsList: EmailCampaign[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          campaignsList.push({
            id: doc.id,
            sellerId: data.sellerId,
            subject: data.subject,
            message: data.message,
            recipientType: data.recipientType,
            segment: data.segment,
            recipientEmails: data.recipientEmails,
            recipientCount: data.recipientCount || 0,
            deliveredCount: data.deliveredCount || 0,
            status: data.status || 'draft',
            sentAt: data.sentAt?.toDate(),
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
        setCampaigns(campaignsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching email campaigns:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { campaigns, loading, error };
}

