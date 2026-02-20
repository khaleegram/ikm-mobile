// Client-side hooks for reading Market Message data (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  doc,
} from 'firebase/firestore';
import { firestore } from '../config';
import { MarketMessage } from '@/types';

// Get user's chat list with real-time updates
export function useMarketChats(userId: string | null) {
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setChats([]);
      setLoading(false);
      return;
    }

    // Query chats where user is either buyer or seller
    const q = query(
      collection(firestore, 'marketChats'),
      where('participants', 'array-contains', userId),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const chatsList: any[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          chatsList.push({
            id: doc.id,
            ...data,
            updatedAt: data.updatedAt?.toDate() || new Date(),
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
        setChats(chatsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market chats:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { chats, loading, error };
}

// Get messages for a specific chat with real-time updates
export function useMarketChat(chatId: string | null) {
  const [messages, setMessages] = useState<MarketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'marketChats', chatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messagesList: MarketMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const message: MarketMessage = {
            id: doc.id,
            chatId: chatId,
            senderId: data.senderId || '',
            receiverId: data.receiverId || '',
            postId: data.postId || '',
            message: data.message || '',
            imageUrl: data.imageUrl,
            paymentLink: data.paymentLink,
            read: data.read || false,
            createdAt: data.createdAt?.toDate() || new Date(),
          };
          messagesList.push(message);
        });
        setMessages(messagesList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching market chat messages:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [chatId]);

  return { messages, loading, error };
}
