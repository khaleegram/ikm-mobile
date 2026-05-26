import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { collection, query, where, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { firestore } from '@/lib/firebase/config';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { haptics } from '@/lib/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useActiveStatuses, useMyActiveStatuses, addMarketStatus, MarketStatus } from '@/lib/firebase/firestore/market-statuses';
import { uploadImage } from '@/lib/utils/image-upload';
import { showToast } from '@/components/toast';
import { IconSymbol } from '@/components/ui/icon-symbol';

const CARD_WIDTH = 96;
const CARD_HEIGHT = 144;
const AVATAR_SIZE = 36;
const RING_SIZE = AVATAR_SIZE + 4;

interface SellerStory {
  uid: string;
  displayName: string;
  storeName?: string;
  photoURL?: string;
  storeLogoUrl?: string;
  statuses: MarketStatus[];
}

function StoryItem({ seller, isMe, onAddStatus, isUploading }: { seller: SellerStory; isMe?: boolean; onAddStatus?: () => void; isUploading?: boolean }) {
  const name = isMe ? 'My status' : (seller.storeName || seller.displayName || 'Seller').split(' ')[0];
  const avatarUri = seller.storeLogoUrl || seller.photoURL || null;
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  
  const hasStatus = seller.statuses.length > 0;
  const latestStatusMedia = hasStatus ? seller.statuses[seller.statuses.length - 1].mediaUrl : null;

  const handlePress = useCallback(() => {
    haptics.light();
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 0.92, useNativeDriver: true, tension: 400, friction: 5 }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 4 }),
    ]).start();
    
    if (isMe && !hasStatus) {
      onAddStatus?.();
    } else if (hasStatus) {
      router.push(`/(market)/status/${encodeURIComponent(seller.uid)}` as any);
    }
  }, [seller.uid, scaleAnim, isMe, hasStatus, onAddStatus]);

  return (
    <Animated.View style={[styles.storyCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85} style={styles.cardInner} disabled={isUploading}>
        {/* Background: use latest status image if available, else dark gradient */}
        {latestStatusMedia ? (
          <Image
            source={{ uri: latestStatusMedia }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
          />
        ) : (
          <LinearGradient
            colors={['#2A2A2C', '#1A1A1C']}
            style={StyleSheet.absoluteFillObject}
          />
        )}
        
        {/* Top left avatar with ring */}
        <View style={styles.avatarContainer}>
          <LinearGradient
            colors={hasStatus ? ['#FFD700', '#D4AF37'] : ['transparent', 'transparent']} // Golden ring
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientRing}>
            <View style={styles.avatarBorder}>
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{(seller.storeName || seller.displayName || 'S').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              {isMe && !hasStatus && (
                <View style={styles.addIconBadge}>
                  <IconSymbol name="plus" size={10} color="#000" />
                </View>
              )}
            </View>
          </LinearGradient>
        </View>

        {isUploading && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        )}

        {/* Bottom name */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.nameGradient}>
          <Text style={styles.storyName} numberOfLines={2}>{name}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function SellerStoriesRow() {
  const { user } = useUser();
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [isUploading, setIsUploading] = useState(false);

  const { statuses: activeStatuses } = useActiveStatuses(followedIds);
  const { myStatuses } = useMyActiveStatuses(user?.uid || null);
  const { user: myProfile } = useUserProfile(user?.uid || null);

  // Fetch followed IDs
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(firestore, 'marketFollows'), where('followerId', '==', user.uid), limit(20));
    const unsub = onSnapshot(q, async (snap) => {
      const ids = snap.docs.map(d => String(d.data()?.followedId || '').trim()).filter(Boolean).slice(0, 10);
      setFollowedIds(ids);
      
      // Fetch profiles
      const profs: Record<string, any> = {};
      await Promise.all(
        ids.map(async (uid) => {
          try {
            const docSnap = await getDoc(doc(firestore, 'users', uid));
            if (docSnap.exists()) {
              profs[uid] = docSnap.data();
            }
          } catch {}
        })
      );
      setProfiles(profs);
    });
    return () => unsub();
  }, [user?.uid]);

  const handleAddStatus = async () => {
    if (!user?.uid) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setIsUploading(true);
        const asset = result.assets[0];
        const path = `marketStatuses/${user.uid}/status_${Date.now()}.jpg`;
        const uploadResult = await uploadImage(asset.uri, path);
        await addMarketStatus(user.uid, uploadResult.url);
        haptics.success();
      }
    } catch (e: any) {
      console.error('Add status error:', e);
      showToast('Failed to add status', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const myStory: SellerStory | null = user ? {
    uid: user.uid,
    displayName: myProfile?.displayName || 'Me',
    storeName: myProfile?.storeName,
    photoURL: myProfile?.photoURL,
    storeLogoUrl: myProfile?.storeLogoUrl,
    statuses: myStatuses || [],
  } : null;

  const sellersWithStatus = useMemo(() => {
    return followedIds
      .map(uid => {
        const prof = profiles[uid];
        const userStatuses = activeStatuses[uid] || [];
        if (!prof || userStatuses.length === 0) return null; // ONLY show if they have a status
        return {
          uid,
          displayName: prof.displayName || '',
          storeName: prof.storeName,
          photoURL: prof.photoURL,
          storeLogoUrl: prof.storeLogoUrl,
          statuses: userStatuses,
        } as SellerStory;
      })
      .filter((s): s is SellerStory => s !== null);
  }, [followedIds, profiles, activeStatuses]);

  if (!user) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast">
        
        {myStory && (
          <StoryItem 
            seller={myStory} 
            isMe 
            onAddStatus={handleAddStatus} 
            isUploading={isUploading} 
          />
        )}

        {sellersWithStatus.map((seller) => (
          <StoryItem key={seller.uid} seller={seller} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 10,
    paddingRight: 20,
    paddingVertical: 4,
  },
  storyCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  cardInner: {
    flex: 1,
    position: 'relative',
  },
  avatarContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
  },
  gradientRing: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBorder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: '#1A1A1C',
    overflow: 'hidden',
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    backgroundColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  addIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 24,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  storyName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
