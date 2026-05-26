import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, TouchableWithoutFeedback, Animated, ActivityIndicator, Dimensions, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { useMyActiveStatuses, useActiveStatuses } from '@/lib/firebase/firestore/market-statuses';
import { usePublicUserProfile } from '@/lib/firebase/firestore/users';
import { useUser } from '@/lib/firebase/auth/use-user';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { width, height } = Dimensions.get('window');
const STATUS_DURATION = 5000;

export default function StatusViewerScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const isMe = user?.uid === sellerId;

  const { statuses, loading: statusesLoading } = useActiveStatuses(isMe ? [] : [sellerId || '']);
  const { myStatuses, loading: myStatusesLoading } = useMyActiveStatuses(isMe ? user?.uid || null : null);
  
  const activeStatuses = isMe ? myStatuses : (statuses[sellerId || ''] || []);
  const loading = isMe ? myStatusesLoading : statusesLoading;
  
  const { user: sellerProfile } = usePublicUserProfile(sellerId || null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) return;
    
    if (activeStatuses.length === 0) {
      router.back();
      return;
    }

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STATUS_DURATION,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        goToNext();
      }
    });

    return () => progressAnim.stopAnimation();
  }, [currentIndex, loading, activeStatuses.length]);

  const goToNext = () => {
    if (currentIndex < activeStatuses.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      router.back();
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    } else {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: STATUS_DURATION,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) goToNext();
      });
    }
  };

  const handlePress = (e: any) => {
    const x = e.nativeEvent.locationX;
    if (x < width * 0.3) {
      goToPrev();
    } else {
      goToNext();
    }
  };

  if (loading || activeStatuses.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const currentStatus = activeStatuses[currentIndex];
  const name = sellerProfile?.storeName || sellerProfile?.displayName || 'Status';
  const avatarUri = sellerProfile?.storeLogoUrl || sellerProfile?.photoURL;

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <TouchableWithoutFeedback onPress={handlePress}>
        <View style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri: currentStatus.mediaUrl }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={styles.topGradient}
          />
        </View>
      </TouchableWithoutFeedback>

      {/* Top Header UI */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 16) }]}>
        {/* Progress Bars */}
        <View style={styles.progressRow}>
          {activeStatuses.map((_, index) => {
            return (
              <View key={index} style={styles.progressBarBg}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: index === currentIndex
                        ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                        : index < currentIndex ? '100%' : '0%',
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>

        {/* User Info */}
        <View style={styles.userInfoRow}>
          <View style={styles.userInfoLeft}>
            <TouchableWithoutFeedback onPress={() => router.back()}>
              <View style={styles.backButton}>
                <IconSymbol name="chevron.left" size={24} color="#FFF" />
              </View>
            </TouchableWithoutFeedback>
            
            <View style={styles.avatarBorder}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <Text style={styles.userName}>{isMe ? 'My Status' : name}</Text>
          </View>
          
          <TouchableWithoutFeedback onPress={() => router.back()}>
            <View style={styles.closeButton}>
              <IconSymbol name="xmark" size={24} color="#FFF" />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
  },
  progressBarBg: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  closeButton: {
    padding: 4,
  },
  avatarBorder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FFF',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    backgroundColor: '#A67C52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  userName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
