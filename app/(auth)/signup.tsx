// Signup screen with premium brown gradient design
import { auth, firestore } from '@/lib/firebase/config';
import { router } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SignupScreen() {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isValidName = displayName.trim().length >= 2;
  const isValidEmail = email.includes('@') && email.includes('.');
  const isValidPassword = password.length >= 6;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSignup = async () => {
    if (!displayName || !email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
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
      // Create user account
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      // Update display name
      await updateProfile(user, { displayName });

      // Create user document in Firestore with seller role
      await setDoc(doc(firestore, 'users', user.uid), {
        id: user.uid,
        email,
        displayName,
        role: 'seller',
        isAdmin: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Force refresh the ID token to ensure latest data
      await user.getIdToken(true);
      
      // Navigation will happen automatically via auth state change
    } catch (error: any) {
      Alert.alert('Signup Failed', error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const styles = createStyles(colors, colorScheme);

  return (
    <LinearGradient
      colors={colorScheme === 'light' 
        ? [colors.primary, colors.accent] 
        : [colors.gradientStart, colors.gradientEnd]}
      style={styles.gradient}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={[styles.logoContainer, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
                <IconSymbol name="storefront.fill" size={48} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Join us and start selling</Text>
            </View>

            <View style={[styles.formCard, { backgroundColor: colors.card }]}>
              {/* Full Name Input */}
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Full Name</Text>
                <View style={[styles.inputWrapper, { 
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: isValidName ? colors.success : colors.cardBorder 
                }]}>
                  <IconSymbol name="person.fill" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="Enter your full name"
                    placeholderTextColor={colors.textSecondary}
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                  />
                  {isValidName && (
                    <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
                  )}
                </View>
              </View>

              {/* Email Input */}
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Email</Text>
                <View style={[styles.inputWrapper, { 
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: isValidEmail ? colors.success : colors.cardBorder 
                }]}>
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
                  {isValidEmail && (
                    <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
                  )}
                </View>
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Password</Text>
                <View style={[styles.inputWrapper, { 
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: isValidPassword ? colors.success : colors.cardBorder 
                }]}>
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
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeButton}>
                    <IconSymbol
                      name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
                      size={24}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Confirm Password</Text>
                <View style={[styles.inputWrapper, { 
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: passwordsMatch ? colors.success : (confirmPassword.length > 0 ? colors.error : colors.cardBorder)
                }]}>
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
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeButton}>
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

              {/* Sign Up Button */}
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSignup}
                disabled={loading}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={colorScheme === 'light' 
                    ? [colors.primary, colors.accent] 
                    : [colors.primary, colors.accent]}
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

              {/* Sign In Link */}
              <View style={styles.signinContainer}>
                <Text style={[styles.signinText, { color: colors.textSecondary }]}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.back()}>
                  <Text style={[styles.signinLink, { color: colors.primary }]}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Decorative Circles */}
            <View style={styles.decorativeCircle1} />
            <View style={styles.decorativeCircle2} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
