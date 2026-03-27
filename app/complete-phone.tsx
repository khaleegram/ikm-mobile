import { IconSymbol } from '@/components/ui/icon-symbol';
import { showToast } from '@/components/toast';
import { useUser } from '@/lib/firebase/auth/use-user';
import { firestore } from '@/lib/firebase/config';
import { useUserProfile } from '@/lib/firebase/firestore/users';
import { useTheme } from '@/lib/theme/theme-context';
import { getDeviceCoordinates } from '@/lib/utils/device-location';
import { generateOtpCode, isValidPhoneNumber, normalizePhoneInput } from '@/lib/utils/phone';
import { haptics } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightBrown = '#A67C52';
const MARKET_LOCATION_PROMPT_KEY = '@ikm_market_location_prompted_v1';

export default function CompletePhoneScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useUser();
  const { user: profile, loading } = useUserProfile(user?.uid || null);

  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [pendingOtpCode, setPendingOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capturingLocation, setCapturingLocation] = useState(false);

  const existingPhone = useMemo(() => {
    return normalizePhoneInput(String(profile?.phone || '').trim());
  }, [profile?.phone]);
  const hasVerifiedPhone = useMemo(() => {
    return Boolean(profile?.phoneVerified) && Boolean(existingPhone);
  }, [existingPhone, profile?.phoneVerified]);
  const normalizedPhone = useMemo(() => normalizePhoneInput(phone || existingPhone), [existingPhone, phone]);
  const isValidPhone = isValidPhoneNumber(normalizedPhone);
  const hasShownLocationPromptRef = useRef(false);

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
    if (!user) {
      router.replace('/(market)' as any);
      return;
    }
    if (hasVerifiedPhone) {
      router.replace('/(market)' as any);
    }
  }, [hasVerifiedPhone, user]);

  React.useEffect(() => {
    if (!existingPhone) return;
    setPhone(existingPhone);
  }, [existingPhone]);

  React.useEffect(() => {
    if (!user?.uid) return;
    if (!otpVerified) return;
    if (hasCoordinates) return;
    if (hasShownLocationPromptRef.current) return;

    hasShownLocationPromptRef.current = true;

    void (async () => {
      try {
        const alreadyPrompted = await AsyncStorage.getItem(MARKET_LOCATION_PROMPT_KEY);
        if (alreadyPrompted) return;
        await AsyncStorage.setItem(MARKET_LOCATION_PROMPT_KEY, '1');

        Alert.alert(
          'Use your location?',
          'Allow IKM to use your device location to help prefill delivery settings. You can change it later.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Allow', onPress: () => void handleUseDeviceLocation() },
          ]
        );
      } catch {
        // Non-blocking. User can still capture location manually.
      }
    })();
  }, [handleUseDeviceLocation, hasCoordinates, otpVerified, user?.uid]);

  const handleSendOtp = () => {
    if (!isValidPhone) {
      showToast('Enter a valid phone number first.', 'error');
      return;
    }

    const code = generateOtpCode();
    setPendingOtpCode(code);
    setOtpCode('');
    setOtpVerified(false);
    haptics.medium();
    Alert.alert(
      'OTP Sent',
      `Use this OTP: ${code}\n\nReplace this test OTP flow with your SMS backend in production.`
    );
  };

  const handleVerifyOtp = () => {
    if (!pendingOtpCode) {
      showToast('Send OTP first.', 'error');
      return;
    }

    if (String(otpCode || '').trim() !== pendingOtpCode) {
      haptics.error();
      showToast('Invalid OTP code.', 'error');
      return;
    }

    haptics.success();
    setOtpVerified(true);
    showToast('Phone verified.', 'success');
  };

  const handleUseDeviceLocation = useCallback(async () => {
    if (!user?.uid) return;

    try {
      setCapturingLocation(true);
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
        { merge: true }
      );
      haptics.success();
      showToast('Device location captured.', 'success');
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Unable to get device location.', 'error');
    } finally {
      setCapturingLocation(false);
    }
  }, [profile?.marketBuyerLocation, user?.uid]);

  const handleContinue = async () => {
    if (!user?.uid) {
      router.replace('/(market)' as any);
      return;
    }
    if (!isValidPhone) {
      showToast('Enter a valid phone number.', 'error');
      return;
    }
    if (!otpVerified) {
      showToast('Verify your phone with OTP before continuing.', 'error');
      return;
    }

    try {
      setSubmitting(true);
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          phone: normalizedPhone,
          phoneVerified: true,
          phoneVerifiedAt: serverTimestamp(),
          marketBuyerPhone: normalizedPhone,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      haptics.success();
      router.replace('/(market)' as any);
    } catch (error: any) {
      haptics.error();
      showToast(error?.message || 'Failed to save phone verification.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || loading) {
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
      <View style={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.headerBadge, { backgroundColor: `${lightBrown}1A` }]}>
          <IconSymbol name="lock.shield.fill" size={16} color={lightBrown} />
          <Text style={[styles.headerBadgeText, { color: lightBrown }]}>Security Step</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Verify your phone</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Add and verify your phone before entering Market Street.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Phone Number</Text>
          <TextInput
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              setOtpVerified(false);
            }}
            placeholder="+2348012345678"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: isValidPhone ? lightBrown : colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />

          <View style={styles.otpRow}>
            <TouchableOpacity
              style={[styles.inlineButton, { borderColor: colors.border }]}
              onPress={handleSendOtp}>
              <Text style={[styles.inlineButtonText, { color: colors.text }]}>
                {pendingOtpCode ? 'Resend OTP' : 'Send OTP'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.inlineButton, { borderColor: otpVerified ? lightBrown : colors.border }]}
              onPress={handleVerifyOtp}>
              <Text style={[styles.inlineButtonText, { color: otpVerified ? lightBrown : colors.text }]}>
                {otpVerified ? 'Verified' : 'Verify OTP'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>OTP Code</Text>
          <TextInput
            value={otpCode}
            onChangeText={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Enter 6-digit code"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            maxLength={6}
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: otpVerified ? lightBrown : colors.border,
                backgroundColor: colors.backgroundSecondary,
              },
            ]}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Device Location (Optional)</Text>
          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            Capture your current coordinates as delivery defaults. You can edit state/city/address later.
          </Text>
          <TouchableOpacity
            style={[styles.secondaryAction, { borderColor: colors.border }]}
            onPress={handleUseDeviceLocation}
            disabled={capturingLocation}>
            {capturingLocation ? (
              <ActivityIndicator size="small" color={lightBrown} />
            ) : (
              <>
                <IconSymbol name="location.fill" size={16} color={lightBrown} />
                <Text style={[styles.secondaryActionText, { color: colors.text }]}>Use Device Location</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryAction,
            {
              backgroundColor: submitting ? `${lightBrown}AA` : lightBrown,
              opacity: submitting ? 0.85 : 1,
            },
          ]}
          onPress={handleContinue}
          disabled={submitting}>
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryActionText}>Continue to App</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 14,
  },
  headerBadge: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: -4,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  inlineButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  helper: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  secondaryAction: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  primaryAction: {
    marginTop: 'auto',
    minHeight: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
