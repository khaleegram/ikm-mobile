import { auth } from '@/lib/firebase/config';
import { useUser } from '@/lib/firebase/auth/use-user';
import { getSignupRouteForVariant } from '@/lib/utils/auth-routes';
import { AppVariant } from '@/lib/utils/app-variant';
import { haptics } from '@/lib/utils/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { router } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardScreen from '@/components/layout/KeyboardScreen';

type AuthLoginScreenProps = {
  variant: AppVariant;
};

export function AuthLoginScreen({ variant }: AuthLoginScreenProps) {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const lightBrown = '#A67C52';

  const copy = useMemo(() => {
    if (variant === 'seller') {
      return {
        title: 'Merchant\nPortal',
        buttonText: 'Sign In to Dashboard',
        secondaryText: 'New here?',
        secondaryCta: 'Create Merchant Account',
      };
    }
    return {
      title: 'Market\nStreet',
      buttonText: 'Sign In',
      secondaryText: 'New here?',
      secondaryCta: 'Create Account',
    };
  }, [variant]);

  // Once signed in, let root routing decide the final destination.
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    router.replace('/');
  }, [user, authLoading]);

  const handleLogin = () => {
    if (loading) return;
    setLoading(true);

    setTimeout(async () => {
      try {
        if (!email || !password) {
          haptics.error();
          Alert.alert('Error', 'Please fill in all fields');
          return;
        }

        await signInWithEmailAndPassword(auth, email.trim(), password);
        haptics.success();
        router.replace('/');
      } catch (error: any) {
        haptics.error();
        const msg = error?.message || error?.code || 'Unknown error';
        Alert.alert('Login Failed', msg);
      } finally {
        setLoading(false);
      }
    }, 0);
  };

  const handleForgotCredentials = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      Alert.alert('Email Required', 'Enter your email address first, then try again.');
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, normalizedEmail);
      haptics.success();
      Alert.alert('Reset Link Sent', `A password reset email was sent to ${normalizedEmail}.`);
    } catch (error: any) {
      haptics.error();
      Alert.alert('Reset Failed', error?.message || 'Unable to send password reset link.');
    } finally {
      setLoading(false);
    }
  };

  const styles = createStyles(colors, insets, lightBrown);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <KeyboardScreen
        keyboardVerticalOffset={insets.top}
        extraScrollHeight={32}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <IconSymbol name="storefront.fill" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.welcomeText}>{copy.title}</Text>
            <View style={styles.accentBar} />
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.input}
                placeholder="name@store.com"
                placeholderTextColor={colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="********"
                  placeholderTextColor={colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPassword((prev) => !prev)}>
                  <IconSymbol name={showPassword ? 'eye.slash' : 'eye'} size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.forgotBtn} onPress={handleForgotCredentials}>
              <Text style={styles.forgotText}>Forgot Credentials?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.mainButton}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}>
              <>
                <Text style={styles.buttonText}>{copy.buttonText}</Text>
                <IconSymbol name="arrow.right" size={18} color="#fff" />
              </>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push(getSignupRouteForVariant(variant) as any)}>
              <Text style={styles.secondaryButtonText}>
                {copy.secondaryText}{' '}
                <Text style={{ color: lightBrown, fontWeight: '800' }}>{copy.secondaryCta}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardScreen>
    </View>
  );
}

const createStyles = (colors: any, insets: any, themeBrown: string) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { flexGrow: 1 },
    content: { flex: 1, paddingHorizontal: 32, paddingTop: insets.top + 60 },

    header: { marginBottom: 60 },
    logoCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: themeBrown,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 24,
    },
    welcomeText: {
      fontSize: 42,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 48,
      letterSpacing: -1,
    },
    accentBar: {
      width: 40,
      height: 6,
      backgroundColor: themeBrown,
      marginTop: 16,
      borderRadius: 3,
    },

    form: { gap: 32 },
    inputGroup: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
    label: {
      fontSize: 10,
      fontWeight: '800',
      color: themeBrown,
      letterSpacing: 1.5,
      marginBottom: 8,
    },
    input: {
      fontSize: 18,
      color: colors.text,
      fontWeight: '600',
      paddingVertical: 8,
    },
    passwordWrapper: { flexDirection: 'row', alignItems: 'center' },
    forgotBtn: { alignSelf: 'flex-start', marginTop: 8 },
    forgotText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

    footer: { marginTop: 'auto', marginBottom: insets.bottom + 40 },
    mainButton: {
      backgroundColor: themeBrown,
      height: 64,
      borderRadius: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      shadowColor: themeBrown,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 8,
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    secondaryButton: { marginTop: 24, alignItems: 'center' },
    secondaryButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  });
