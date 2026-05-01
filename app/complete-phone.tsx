import { SmartPhoneField } from '@/components/ui/smart-phone-field';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getMarketBranding } from '@/lib/market-branding';
import { getDeviceCoordinates } from '@/lib/utils/device-location';
import { isMarketPhoneGateSatisfied } from '@/lib/utils/market-phone-gate';
import { isValidPhoneNumber, normalizePhoneInput } from '@/lib/utils/phone';
import { haptics } from '@/lib/utils/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightBrown = '#A67C52';
const MARKET_LOCATION_PROMPT_KEY = '@ikm_market_location_prompted_v1';

export default function CompletePhoneScreen() {
  const marketBrand = getMarketBranding();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, loading: authLoading } = useUser();
  const { user: profile, loading: profileLoading } = useUserProfile(user?.uid || null);
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const allowEdit = edit === '1' || edit === 'true';

  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const existingPhone = useMemo(
    () => normalizePhoneInput(String(profile?.phone || profile?.marketBuyerPhone || '').trim()),
    [profile?.marketBuyerPhone, profile?.phone],
  );
  const phoneComplete = useMemo(() => isMarketPhoneGateSatisfied(profile), [profile]);
  const normalizedPhone = useMemo(() => normalizePhoneInput(phone || existingPhone), [existingPhone, phone]);
  const isValidPhone = isValidPhoneNumber(normalizedPhone);

  const hasCoordinates = useMemo(() => {
    const raw = (profile?.marketBuyerLocation || {}) as any;
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) > 0.0001 &&
      Math.abs(longitude) > 0.0001
    );
  }, [profile?.marketBuyerLocation]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/(market)' as any);
      return;
    }
    if (phoneComplete && !allowEdit) {
      router.replace('/(market)' as any);
    }
  }, [allowEdit, authLoading, phoneComplete, user]);

  React.useEffect(() => {
    if (!existingPhone) return;
    setPhone(existingPhone);
  }, [existingPhone]);

  const afterSaveNavigation = useCallback(async () => {
    if (!hasCoordinates) {
      try {
        const alreadyPrompted = await AsyncStorage.getItem(MARKET_LOCATION_PROMPT_KEY);
        if (!alreadyPrompted) {
          await AsyncStorage.setItem(MARKET_LOCATION_PROMPT_KEY, '1');
          await new Promise<void>((resolve) => {
            Alert.alert(
              'Use your location?',
              `${marketBrand.proseName} can use your location to prefill delivery details. You can change this anytime.`,
              [
                {
                  text: 'Not now',
                  style: 'cancel',
                  onPress: () => resolve(),
                },
                {
                  text: 'Allow',
                  onPress: () => {
                    void (async () => {
                      try {
                        if (!user?.uid) {
                          resolve();
                          return;
                        }
                        const coordinates = await getDeviceCoordinates();
                        const currentLocation = (profile?.marketBuyerLocation || {}) as any;
                        await setDoc(
                          doc(firestore, 'users', user.uid),
                          {
                            marketBuyerLocation: {
                              state: String(currentLocation.state || ''),
                              city: String(currentLocation.city || ''),
                              address: String(currentLocation.address || ''),
                              latitude: coordinates.latitude,
                              longitude: coordinates.longitude,
                            },
                            updatedAt: serverTimestamp(),
                          },
                          { merge: true },
                        );
                        haptics.success();
                        showToast('Location saved.', 'success');
                      } catch (error: any) {
                        haptics.error();
                        showToast(error?.message || 'Could not save location.', 'error');
                      } finally {
                        resolve();
                      }
                    })();
                  },
                },
              ],
              { cancelable: true, onDismiss: () => resolve() },
            );
          });
        }
      } catch {
        // non-blocking
      }
    }
    router.replace('/(market)' as any);
  }, [hasCoordinates, marketBrand.proseName, profile?.marketBuyerLocation, user?.uid]);

  const handleContinue = async () => {
    if (!user?.uid) {
      router.replace('/(market)' as any);
      return;
    }
    if (!isValidPhone) {
      showToast('Enter a valid mobile number.', 'error');
      return;
    }

    try {
      setSubmitting(true);
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          phone: normalizedPhone,
          marketBuyerPhone: normalizedPhone,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      try {
        const serverSnap = await getDocFromServer(doc(firestore, 'users', user.uid));
        const savedRaw = String(serverSnap.data()?.phone ?? serverSnap.data()?.marketBuyerPhone ?? '').trim();
        if (!isValidPhoneNumber(normalizePhoneInput(savedRaw))) {
          showToast('Could not confirm your number was saved. Try again.', 'error');
          return;
        }
      } catch {
        // Offline / transient read failure — local merge from setDoc is still OK to continue.
      }

      haptics.success();
      showToast('Phone saved.', 'success');
      await afterSaveNavigation();
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Could not save your number.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || profileLoading || !user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={lightBrown} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.kicker, { color: lightBrown }]}>{marketBrand.headerLine}</Text>

        <View style={[styles.heroIcon, { backgroundColor: `${lightBrown}18`, borderColor: `${lightBrown}40` }]}>
          <IconSymbol name="phone.fill" size={28} color={lightBrown} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {allowEdit ? 'Update your phone' : 'Add your phone'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{marketBrand.phoneGateLine}</Text>

        <View style={[styles.mainCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SmartPhoneField
            value={phone}
            onChange={setPhone}
            colors={{
              text: colors.text,
              textSecondary: colors.textSecondary,
              border: colors.border,
              background: colors.background,
              backgroundSecondary: colors.backgroundSecondary,
              card: colors.card,
            }}
            accentColor={lightBrown}
            borderColor={isValidPhone ? lightBrown : colors.border}
            placeholder="801 234 5678"
          />
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: submitting || !isValidPhone ? `${lightBrown}88` : lightBrown },
            ]}
            onPress={() => void handleContinue()}
            disabled={submitting || !isValidPhone}
            activeOpacity={0.85}>
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 22, gap: 18 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    alignSelf: 'center',
  },
  heroIcon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    marginTop: -6,
    paddingHorizontal: 12,
  },
  mainCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 4,
    padding: 18,
    gap: 14,
  },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
