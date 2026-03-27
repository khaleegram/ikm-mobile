import { IconSymbol } from '@/components/ui/icon-symbol';
import { auth, firestore } from '@/lib/firebase/config';
import { useTheme } from '@/lib/theme/theme-context';
import { getLoginRouteForVariant } from '@/lib/utils/auth-routes';
import { AppVariant } from '@/lib/utils/app-variant';
import { haptics } from '@/lib/utils/haptics';
import { toNameCase } from '@/lib/utils/name-case';
import { generateOtpCode, isValidPhoneNumber, normalizePhoneInput } from '@/lib/utils/phone';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardScreen from '@/components/layout/KeyboardScreen';

type AuthSignupScreenProps = {
  variant: AppVariant;
};

export function AuthSignupScreen({ variant }: AuthSignupScreenProps) {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [pendingOtpCode, setPendingOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);

  const copy = useMemo(() => {
    if (variant === 'seller') {
      return {
        title: 'Create Account',
        subtitle: 'Join and start selling',
      };
    }
    return {
      title: 'Create Account',
      subtitle: 'Join Market Street',
    };
  }, [variant]);

  const isValidName = displayName.trim().length >= 2;
  const isValidEmail = email.includes('@') && email.includes('.');
  const normalizedPhone = normalizePhoneInput(phone);
  const isValidPhone = isValidPhoneNumber(normalizedPhone);
  const isValidPassword = password.length >= 6;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSendOtp = () => {
    if (!isValidPhone) {
      Alert.alert('Invalid Phone', 'Enter a valid phone number to continue.');
      return;
    }

    const code = generateOtpCode();
    setPendingOtpCode(code);
    setOtpCode('');
    setOtpVerified(false);
    haptics.medium();
    Alert.alert(
      'OTP Sent',
      `Use this OTP to continue: ${code}\n\nReplace this test flow with your SMS provider in production.`
    );
  };

  const handleVerifyOtp = () => {
    if (!pendingOtpCode) {
      Alert.alert('Send OTP First', 'Tap "Send OTP" to receive a verification code.');
      return;
    }

    if (String(otpCode || '').trim() !== pendingOtpCode) {
      haptics.error();
      Alert.alert('Invalid OTP', 'The code you entered is incorrect.');
      return;
    }

    haptics.success();
    setOtpVerified(true);
    Alert.alert('Phone Verified', 'Your phone number has been verified.');
  };

  const handleSignup = async () => {
    const normalizedDisplayName = toNameCase(displayName);

    if (!displayName || !email || !phone || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!normalizedDisplayName || normalizedDisplayName.length < 2) {
      Alert.alert('Error', 'Enter a valid full name');
      return;
    }

    if (!isValidPhone) {
      Alert.alert('Error', 'Enter a valid phone number');
      return;
    }

    if (!otpVerified) {
      Alert.alert('Verify Phone', 'You must verify your phone number with OTP before signing up.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: normalizedDisplayName });

      // Market users share one role/privileges inside Market app.
      // Seller app creates seller users directly.
      const role = variant === 'seller' ? 'seller' : 'user';

      await setDoc(doc(firestore, 'users', user.uid), {
        id: user.uid,
        email: email.trim(),
        displayName: normalizedDisplayName,
        phone: normalizedPhone,
        phoneVerified: true,
        phoneVerifiedAt: serverTimestamp(),
        marketBuyerPhone: normalizedPhone,
        role,
        isAdmin: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await user.getIdToken(true);
      haptics.success();
      router.replace('/');
    } catch (error: any) {
      haptics.error();
      Alert.alert('Signup Failed', error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const styles = createStyles(colors, colorScheme);

  return (
    <LinearGradient
      colors={colorScheme === 'light' ? [colors.primary, colors.accent] : [colors.gradientStart, colors.gradientEnd]}
      style={styles.gradient}>
      <KeyboardScreen
        style={styles.container}
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={32}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
              <IconSymbol name="storefront.fill" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: colors.card }]}>
            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Full Name</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: isValidName ? colors.success : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="person.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Enter your full name"
                  placeholderTextColor={colors.textSecondary}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                />
                {isValidName && <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />}
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Email</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: isValidEmail ? colors.success : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="person.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Enter your email"
                  placeholderTextColor={colors.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
              {isValidEmail && <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />}
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Phone Number</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: isValidPhone ? colors.success : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="phone.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Enter your phone number"
                  placeholderTextColor={colors.textSecondary}
                  value={phone}
                  onChangeText={(value) => {
                    setPhone(value);
                    setOtpVerified(false);
                    setPendingOtpCode('');
                    setOtpCode('');
                  }}
                  keyboardType="phone-pad"
                />
                {isValidPhone && <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />}
              </View>
            </View>

            <View style={styles.otpActions}>
              <TouchableOpacity
                style={[styles.otpButton, { borderColor: colors.cardBorder }]}
                onPress={handleSendOtp}
                activeOpacity={0.8}>
                <Text style={[styles.otpButtonText, { color: colors.text }]}>
                  {pendingOtpCode ? 'Resend OTP' : 'Send OTP'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.otpButton, { borderColor: otpVerified ? colors.success : colors.cardBorder }]}
                onPress={handleVerifyOtp}
                activeOpacity={0.8}>
                <Text style={[styles.otpButtonText, { color: otpVerified ? colors.success : colors.text }]}>
                  {otpVerified ? 'Verified' : 'Verify OTP'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>OTP Code</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: otpVerified ? colors.success : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="lock.shield.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor={colors.textSecondary}
                  value={otpCode}
                  onChangeText={(value) => {
                    setOtpCode(value.replace(/\D/g, '').slice(0, 6));
                    if (otpVerified) setOtpVerified(false);
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {otpVerified && <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />}
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Password</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: isValidPassword ? colors.success : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="lock.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, styles.passwordInput, { color: colors.text }]}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <IconSymbol
                    name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
                    size={24}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Confirm Password</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: passwordsMatch ? colors.success : confirmPassword.length > 0 ? colors.error : colors.cardBorder,
                  },
                ]}>
                <IconSymbol name="lock.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                <TextInput
                  style={[styles.input, styles.passwordInput, { color: colors.text }]}
                  placeholder="Confirm your password"
                  placeholderTextColor={colors.textSecondary}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoComplete="password"
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                  <IconSymbol
                    name={showConfirmPassword ? 'eye.slash.fill' : 'eye.fill'}
                    size={24}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <Text style={[styles.errorText, { color: colors.error }]}>Passwords do not match</Text>
              )}
            </View>

            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignup} disabled={loading} activeOpacity={0.8}>
              <LinearGradient
                colors={colorScheme === 'light' ? [colors.primary, colors.accent] : [colors.primary, colors.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.buttonGradient}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>SIGN UP</Text>
                    <IconSymbol name="arrow.right" size={20} color="#FFFFFF" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.signinContainer}>
              <Text style={[styles.signinText, { color: colors.textSecondary }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.push(getLoginRouteForVariant(variant) as any)}>
                <Text style={[styles.signinLink, { color: colors.primary }]}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.decorativeCircle1} />
          <View style={styles.decorativeCircle2} />
        </View>
      </KeyboardScreen>
    </LinearGradient>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>, colorScheme: 'light' | 'dark') =>
  StyleSheet.create({
    gradient: {
      flex: 1,
    },
    container: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    header: {
      alignItems: 'center',
      marginBottom: 40,
    },
    logoContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 32,
      fontWeight: 'bold',
      color: '#fff',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: 'rgba(255, 255, 255, 0.9)',
    },
    formCard: {
      borderRadius: 24,
      padding: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
      elevation: 10,
    },
    inputContainer: {
      marginBottom: 20,
    },
    otpActions: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 20,
    },
    otpButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      paddingHorizontal: 10,
    },
    otpButtonText: {
      fontSize: 13,
      fontWeight: '700',
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
    },
    input: {
      flex: 1,
      paddingVertical: 16,
      fontSize: 16,
    },
    passwordInput: {
      paddingRight: 8,
    },
    eyeButton: {
      padding: 8,
    },
    errorText: {
      fontSize: 12,
      marginTop: 4,
      marginLeft: 4,
    },
    button: {
      borderRadius: 12,
      overflow: 'hidden',
      marginTop: 8,
      marginBottom: 24,
      shadowColor: colorScheme === 'light' ? colors.primary : '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    buttonGradient: {
      paddingVertical: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
      letterSpacing: 1,
    },
    signinContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
    },
    signinText: {
      fontSize: 14,
    },
    signinLink: {
      fontSize: 14,
      fontWeight: 'bold',
    },
    decorativeCircle1: {
      position: 'absolute',
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      top: 50,
      right: -50,
    },
    decorativeCircle2: {
      position: 'absolute',
      width: 150,
      height: 150,
      borderRadius: 75,
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      bottom: 100,
      left: -30,
    },
  });
